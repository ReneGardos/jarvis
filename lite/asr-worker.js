// Lokal talegenkendelse med Whisper (transformers.js). Lyden forlader aldrig enheden.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
env.allowLocalModels = false;
let asr = null;
let loadingModel = null;

async function load(model, device) {
  if (asr && loadingModel === model) return asr;
  loadingModel = model;
  asr = await pipeline("automatic-speech-recognition", model, {
    device,
    dtype: device === "webgpu" ? "fp32" : "q8",
    progress_callback: (p) => self.postMessage({ type: "progress", data: p }),
  });
  return asr;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      await load(data.model, data.device);
      self.postMessage({ type: "ready" });
    } else if (data.type === "transcribe") {
      const p = await load(data.model, data.device);
      const out = await p(data.audio, { language: data.language, task: "transcribe", chunk_length_s: 30 });
      self.postMessage({ type: "result", id: data.id, text: (out.text || "").trim() });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, message: String(e?.message || e) });
  }
};
