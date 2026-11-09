import type { InspectionModel } from "../../src/lib/model/loader";

declare global {
  interface Window {
    cameraQA: {
      model: "ready" | "error" | "loading";
      predictionFails: boolean;
      predictions: number;
      releasePrediction?: () => void;
      holdPrediction: boolean;
    };
  }
}

// Doble explícito: verifica estados/controles, nunca precisión, backend ni latencia TF.js.
export async function loadInspectionModel(): Promise<InspectionModel> {
  if (window.cameraQA.model === "loading") return new Promise(() => {});
  if (window.cameraQA.model === "error") throw new Error("Modelo simulado no disponible");
  return {
    info: {
      version: "0.0.0-qa-simulada", threshold: 0.5,
      input: { width: 400, height: 400, channels: 3, scale: 1 / 255, offset: 0 },
      backend: "webgl", source: "network", offline: false, loadMs: 0,
    },
    async predict() {
      window.cameraQA.predictions++;
      if (window.cameraQA.holdPrediction) {
        await new Promise<void>((resolve) => { window.cameraQA.releasePrediction = resolve; });
      }
      if (window.cameraQA.predictionFails) throw new Error("Detalle interno que no debe mostrarse");
      return { verdict: "OK", confidence: 0.9, defectProbability: 0.1, thresholdApplied: 0.5, inferenceMs: 1 };
    },
    dispose() {},
  };
}
