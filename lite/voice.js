// Stemme: lokal Whisper (talegenkendelse) + enhedens egne stemmer (oplæsning). Intet lyd sendes nogen steder hen.
// Wake word "Jarvis", løbende samtale i 30 sek. efter et svar, og afbrydelse når du begynder at tale.
import { $, AGENTS, esc, llm, state, toast } from "./core.js";
import { sendMessage, speakText } from "./app.js";
import { stripActions } from "./core.js";

const FOLLOWUP_MS = 30000, SILENCE_MS = 900, MIN_SPEECH_MS = 350;
const V = { on: false, state: "off", lastReply: 0, worker: null, pending: new Map(), seq: 0 };
const LABEL = { off: "Slukket", loading: "Henter talegenkendelse…", idle: "Lytter efter “Jarvis”…", listening: "Hører dig…",
  transcribing: "Forstår…", thinking: "Tænker…", speaking: "Taler – tal for at afbryde" };

function setState(s) { V.state = s; const l = $("#vLabel"); if (l) l.textContent = LABEL[s]; const o = $("#bigOrb");
  if (o) { o.classList.toggle("off", s === "off"); o.classList.toggle("speaking", s === "speaking"); } }

function asr() {
  if (V.worker) return V.worker;
  V.worker = new Worker(new URL("./asr-worker.js", import.meta.url), { type: "module" });
  V.worker.onmessage = ({ data }) => {
    if (data.type === "progress" && data.data?.progress != null) { const l = $("#vLabel"); if (l && V.state === "loading") l.textContent = `Henter talegenkendelse… ${Math.round(data.data.progress)}%`; }
    if (data.type === "ready") V.pending.get("load")?.resolve();
    if (data.type === "result") { V.pending.get(data.id)?.resolve(data.text); V.pending.delete(data.id); }
    if (data.type === "error") { (V.pending.get(data.id) || V.pending.get("load"))?.reject(new Error(data.message)); }
  };
  return V.worker;
}
const device = () => ("gpu" in navigator ? "webgpu" : "wasm");
function call(msg, id) { return new Promise((resolve, reject) => { V.pending.set(id, { resolve, reject }); asr().postMessage({ ...msg, id }); }); }

async function blobToPcm16k(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  return buf.getChannelData(0);
}

async function handleUtterance(blob) {
  setState("transcribing");
  let text = "";
  try {
    const audio = await blobToPcm16k(blob);
    const id = ++V.seq;
    text = await call({ type: "transcribe", audio, model: state.settings.whisper, device: device(), language: state.settings.lang === "en" ? "english" : "danish" }, id);
  } catch (e) { toast("⚠️ Talegenkendelse: " + e.message, 5000); setState("idle"); return; }
  text = text.replace(/^\[.*?\]$/, "").trim(); // Whisper skriver fx [Musik] ved støj
  if (!text) { setState("idle"); return; }
  $("#vHeard").textContent = "Du sagde: “" + text + "”";
  const followup = Date.now() - V.lastReply < FOLLOWUP_MS;
  const ww = /\b(jarvis|javis|jarvi[sz])\b[,.!?]?\s*/i;
  if (!followup && !ww.test(text)) { setState("idle"); return; }
  const cmd = text.replace(ww, "").trim();
  if (!cmd) { V.lastReply = Date.now(); await say(state.settings.lang === "en" ? "Yes?" : "Ja?"); setState("idle"); return; }
  if (!llm.engine) { await say("Der er ingen AI-model indlæst. Vælg en under Mere."); setState("idle"); return; }
  setState("thinking");
  const answer = await sendMessage(cmd);
  $("#vAnswer").innerHTML = esc(stripActions(answer));
  await say(stripActions(answer));
  V.lastReply = Date.now();
  if (V.on) setState("idle");
}

function say(text) {
  return new Promise((resolve) => {
    setState("speaking");
    const u = speakText(text);
    u.onend = u.onerror = () => resolve();
    setTimeout(resolve, Math.max(4000, text.length * 120)); // sikkerhed hvis onend ikke kommer (iOS)
  });
}

async function start() {
  try {
    setState("loading");
    await call({ type: "load", model: state.settings.whisper, device: device() }, "load");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    Object.assign(V, { on: true, stream, ctx, noise: 0.01, rec: null, chunks: [], start: 0, lastVoice: 0, barge: 0 });
    setState("idle");
    const loop = () => {
      if (!V.on) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      const o = $("#bigOrb"); if (o) o.style.transform = `scale(${1 + Math.min(rms * 8, 0.5)})`;
      const thr = Math.max(0.015, V.noise * 3), now = performance.now(), voiced = rms > thr;
      if (!voiced && !V.rec) V.noise = V.noise * 0.98 + rms * 0.02;
      if (V.state === "speaking") { // afbrydelse
        V.barge = rms > thr * 2.2 ? V.barge + 1 : 0;
        if (V.barge > 8) { speechSynthesis.cancel(); V.barge = 0; V.lastReply = Date.now(); setState("idle"); }
      }
      if (V.state === "idle" || V.state === "listening") {
        if (voiced) {
          V.lastVoice = now;
          if (!V.rec) {
            V.start = now; V.chunks = [];
            const mime = ["audio/webm", "audio/mp4", ""].find((m) => !m || MediaRecorder.isTypeSupported(m));
            const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
            rec.ondataavailable = (e) => e.data.size && V.chunks.push(e.data);
            rec.onstop = () => { const dur = V.lastVoice - V.start; if (dur >= MIN_SPEECH_MS) handleUtterance(new Blob(V.chunks, { type: rec.mimeType })); else setState("idle"); };
            rec.start(250); V.rec = rec; setState("listening");
          }
        } else if (V.rec && now - V.lastVoice > SILENCE_MS) { V.rec.stop(); V.rec = null; }
      }
      V.raf = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    toast(e.name === "NotAllowedError" ? "Mikrofonadgang blev afvist" : "⚠️ " + e.message, 6000);
    stopVoice();
  }
}

export function stopVoice() {
  V.on = false;
  cancelAnimationFrame(V.raf);
  if (V.rec?.state === "recording") V.rec.stop();
  V.rec = null;
  V.stream?.getTracks().forEach((t) => t.stop());
  V.ctx?.close().catch(() => {});
  speechSynthesis.cancel();
  setState("off");
}

export function renderVoice() {
  $("#view").innerHTML = `<div class="voice">
    <div class="big-orb ${V.on ? "" : "off"}" id="bigOrb"></div>
    <div id="vLabel" style="font-size:18px;margin-bottom:18px">${LABEL[V.state]}</div>
    <button class="btn" id="vToggle">${V.on ? "Stop" : "🎙️ Start stemme"}</button>
    <p class="muted" style="text-align:center;max-width:460px;margin-top:22px">Sig <b>“Jarvis”</b> og din besked. Efter et svar kan du fortsætte i 30 sekunder uden at sige “Jarvis”. Tal for at afbryde.<br>
      Agent: ${AGENTS[state.settings.agent]?.icon} ${esc(AGENTS[state.settings.agent]?.name || "")} · Talegenkendelsen kører lokalt på enheden.</p>
    <p id="vHeard" class="muted" style="text-align:center"></p>
    <div id="vAnswer" style="max-width:640px;white-space:pre-wrap;text-align:center"></div></div>`;
  $("#vToggle").onclick = () => { V.on ? stopVoice() : start(); setTimeout(renderVoice, 50); };
}
