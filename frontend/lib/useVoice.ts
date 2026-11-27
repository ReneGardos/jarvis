"use client";
/**
 * Stemmemotor der virker i alle moderne browsere (også mobil):
 *  - Mikrofonen overvåges med en energibaseret VAD (stemmeaktivitet).
 *  - Hver ytring optages og transskriberes lokalt på serveren (faster-whisper).
 *  - Wake word: i hviletilstand reageres kun på ytringer der indeholder "Jarvis".
 *  - Løbende samtale: i 30 sekunder efter et svar behøver man ikke sige "Jarvis".
 *  - Afbrydelse: taler man mens Jarvis svarer, stoppes oplæsningen straks (barge-in).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./api";

export type VoiceState = "off" | "idle" | "listening" | "transcribing" | "thinking" | "speaking";

type Opts = {
  lang: "da" | "en";
  wakeWord: string;
  onCommand: (text: string) => Promise<string>; // returnerer svaret der skal læses op
};

const FOLLOWUP_MS = 30000;
const SILENCE_MS = 900;
const MIN_SPEECH_MS = 350;

export function useVoice({ lang, wakeWord, onCommand }: Opts) {
  const [state, setState] = useState<VoiceState>("off");
  const [level, setLevel] = useState(0);
  const [lastHeard, setLastHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<any>({});
  const stateRef = useRef<VoiceState>("off");
  const set = (s: VoiceState) => { stateRef.current = s; setState(s); };

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const clean = text.replace(/```[\s\S]*?```/g, " (kode udeladt) ").replace(/[#*_`>\[\]]/g, "").slice(0, 3500);
    const res = await fetch(`${API}/api/voice/speak`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, lang }),
    });
    if (!res.ok) throw new Error("Oplæsning fejlede");
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    refs.current.audio = audio;
    set("speaking");
    await new Promise<void>((resolve) => { audio.onended = audio.onpause = () => resolve(); audio.play().catch(() => resolve()); });
    URL.revokeObjectURL(url);
    refs.current.audio = null;
  }, [lang]);

  const interrupt = () => { refs.current.audio?.pause(); };

  const handleUtterance = useCallback(async (blob: Blob) => {
    set("transcribing");
    const fd = new FormData();
    fd.append("audio", blob, "speech.webm");
    fd.append("language", lang);
    let text = "";
    try {
      const r = await fetch(`${API}/api/voice/transcribe`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error((await r.json()).detail);
      text = (await r.json()).text.trim();
    } catch (e: any) { setError(e.message); set("idle"); return; }
    if (!text) { set("idle"); return; }
    setLastHeard(text);
    const inFollowup = Date.now() - (refs.current.lastReply || 0) < FOLLOWUP_MS;
    const ww = new RegExp(`\\b${wakeWord}\\b[,.!?]?\\s*`, "i");
    if (!inFollowup && !ww.test(text)) { set("idle"); return; }
    const command = text.replace(ww, "").trim();
    if (!command) { refs.current.lastReply = Date.now(); await speak(lang === "da" ? "Ja?" : "Yes?").catch(() => {}); set("idle"); return; }
    set("thinking");
    try {
      const answer = await onCommand(command);
      await speak(answer);
    } catch (e: any) { setError(e.message); }
    refs.current.lastReply = Date.now();
    set("idle");
  }, [lang, wakeWord, onCommand, speak]);

  // Altid nyeste handler (undgår forældede closures i lydløkken)
  refs.current.handle = handleUtterance;

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      Object.assign(refs.current, { stream, ctx, an, noise: 0.01, speechStart: 0, lastVoice: 0, recorder: null, chunks: [] });
      set("idle");
      const loop = () => {
        if (stateRef.current === "off") return;
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 12));
        const r = refs.current;
        const threshold = Math.max(0.015, r.noise * 3);
        const now = performance.now();
        const voiced = rms > threshold;
        if (!voiced && !r.recorder) r.noise = r.noise * 0.98 + rms * 0.02; // tilpas til baggrundsstøj

        // Barge-in: brugeren taler mens Jarvis læser op
        if (stateRef.current === "speaking" && rms > threshold * 2.2) {
          r.bargeFrames = (r.bargeFrames || 0) + 1;
          if (r.bargeFrames > 8) { interrupt(); r.bargeFrames = 0; }
        } else r.bargeFrames = 0;

        if (stateRef.current === "idle" || stateRef.current === "listening") {
          if (voiced) {
            r.lastVoice = now;
            if (!r.recorder) {
              r.speechStart = now;
              r.chunks = [];
              const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "" });
              rec.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
              rec.onstop = () => {
                const dur = r.lastVoice - r.speechStart;
                const blob = new Blob(r.chunks, { type: rec.mimeType || "audio/webm" });
                if (dur >= MIN_SPEECH_MS) refs.current.handle(blob); else set("idle");
              };
              rec.start(250);
              r.recorder = rec;
              set("listening");
            }
          } else if (r.recorder && now - r.lastVoice > SILENCE_MS) {
            r.recorder.stop();
            r.recorder = null;
          }
        }
        r.raf = requestAnimationFrame(loop);
      };
      refs.current.raf = requestAnimationFrame(loop);
    } catch (e: any) {
      setError(e.name === "NotAllowedError" ? "Mikrofonadgang blev afvist" : e.message);
      set("off");
    }
  }, []);

  const stop = useCallback(() => {
    const r = refs.current;
    set("off");
    cancelAnimationFrame(r.raf);
    r.recorder?.state === "recording" && r.recorder.stop();
    r.recorder = null;
    r.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    r.ctx?.close();
    interrupt();
  }, []);

  useEffect(() => () => stop(), [stop]);
  return { state, level, lastHeard, error, start, stop, interrupt, speak };
}
