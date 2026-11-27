// Kører AI-modellen i en baggrundstråd, så appen forbliver hurtig. Modellen kører på enhedens GPU via WebGPU.
import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm@0.2";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
