import type { StationConfig } from "./config";

/**
 * Detección de piezas de la estación automática (HU44-T02, RIKDP-227).
 *
 * No usa el modelo de IA: compara fotogramas reducidos a 64×64 en escala de
 * grises (docs/arquitectura/inferencia-navegador.md, «Detección de piezas»).
 * Este módulo es puro para poder probarlo sin cámara: recibe las diferencias
 * ya medidas y decide cuándo inferir. La inferencia ocurre una sola vez por
 * pieza; hasta que la escena vuelve a quedar vacía no se inspecciona otra.
 */

/** Lado del fotograma reducido con el que se compara. */
export const DETECTION_SIZE = 64;
/** 10 fotogramas por segundo. */
export const DETECTION_INTERVAL_MS = 100;

export type Phase = "EMPTY" | "ARRIVING" | "INSPECTED" | "LEAVING";

export const PHASE_LABELS: Record<Phase, string> = {
  EMPTY: "Esperando pieza",
  ARRIVING: "Pieza llegando",
  INSPECTED: "Pieza inspeccionada",
  LEAVING: "Pieza saliendo",
};

/** Avisos que acompañan a la inspección. Se guardan tal cual en `inspection.warnings`. */
export const WARNING_MOTION = "La pieza no se detuvo: se inspeccionó en movimiento";
export const WARNING_DOUBTFUL_COUNT = "Conteo dudoso: llegó otra pieza sin que la escena se vaciara";

export type FrameStats = {
  /** Diferencia media (0–1) con la imagen de la cinta vacía. */
  presence: number;
  /** Diferencia media (0–1) con el fotograma anterior. */
  motion: number;
  /** Diferencia media (0–1) con el fotograma de la última inspección, si hay. */
  change?: number;
  /** Milisegundos (performance.now() o Date.now()). */
  at: number;
};

export type InspectEvent = { kind: "inspect"; warnings: string[] };

export type DetectorConfig = Pick<StationConfig, "presenceThreshold" | "motionThreshold" | "stableFrames" | "maxWaitMs">;

export type Detector = {
  readonly phase: Phase;
  /** Procesa un fotograma. Devuelve un evento cuando hay que inferir sobre ese fotograma. */
  step(frame: FrameStats): InspectEvent | null;
  reset(): void;
};

export function createDetector(config: DetectorConfig): Detector {
  let phase: Phase = "EMPTY";
  let arrivedAt = 0;
  let stillCount = 0;
  let emptyCount = 0;

  const inspect = (warnings: string[]): InspectEvent => {
    phase = "INSPECTED";
    stillCount = 0;
    emptyCount = 0;
    return { kind: "inspect", warnings };
  };

  return {
    get phase() {
      return phase;
    },
    reset() {
      phase = "EMPTY";
      stillCount = 0;
      emptyCount = 0;
    },
    step(frame) {
      const present = frame.presence > config.presenceThreshold;
      const still = frame.motion < config.motionThreshold;

      switch (phase) {
        case "EMPTY":
          if (present) {
            phase = "ARRIVING";
            arrivedAt = frame.at;
            stillCount = still ? 1 : 0;
          }
          return null;

        case "ARRIVING":
          if (!present) {
            phase = "EMPTY";
            return null;
          }
          stillCount = still ? stillCount + 1 : 0;
          if (stillCount >= config.stableFrames) return inspect([]);
          // La cinta no para: se infiere igual, con aviso, para no perder la pieza.
          if (frame.at - arrivedAt >= config.maxWaitMs) return inspect([WARNING_MOTION]);
          return null;

        case "INSPECTED":
          if (!present || !still) {
            phase = "LEAVING";
            emptyCount = present ? 0 : 1;
            stillCount = 0;
          }
          return null;

        case "LEAVING":
          if (!present) {
            emptyCount += 1;
            stillCount = 0;
            if (emptyCount >= config.stableFrames) phase = "EMPTY";
            return null;
          }
          emptyCount = 0;
          stillCount = still ? stillCount + 1 : 0;
          if (stillCount < config.stableFrames) return null;
          // Se volvió a quedar quieta sin vaciarse la escena. Si apenas cambió
          // respecto de la pieza inspectada, es la misma (la tocaron): no se repite.
          if ((frame.change ?? 0) <= config.presenceThreshold) {
            phase = "INSPECTED";
            stillCount = 0;
            return null;
          }
          return inspect([WARNING_DOUBTFUL_COUNT]);
      }
    },
  };
}

/** Convierte RGBA (ImageData.data) a luminancia de 8 bits. */
export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array, out = new Uint8Array(rgba.length / 4)): Uint8Array {
  for (let i = 0, j = 0; j < out.length; i += 4, j += 1) {
    // Rec. 601 con enteros: rápido y suficiente para comparar escenas.
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

/** Diferencia media absoluta entre dos fotogramas en gris, de 0 (iguales) a 1. */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) throw new RangeError("Los fotogramas deben tener el mismo tamaño");
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

/** Promedia varios fotogramas de la cinta vacía para obtener el fondo de referencia. */
export function averageFrames(frames: readonly Uint8Array[]): Uint8Array {
  if (frames.length === 0) throw new RangeError("Se necesita al menos un fotograma");
  const size = frames[0].length;
  const sums = new Uint32Array(size);
  for (const frame of frames) {
    if (frame.length !== size) throw new RangeError("Los fotogramas deben tener el mismo tamaño");
    for (let i = 0; i < size; i += 1) sums[i] += frame[i];
  }
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = Math.round(sums[i] / frames.length);
  return out;
}

/**
 * Sugiere umbrales a partir del ruido de la cinta vacía medido al calibrar:
 * el doble del ruido observado, sin bajar de un mínimo razonable.
 */
export function suggestThresholds(noise: { presence: number; motion: number }): {
  presenceThreshold: number;
  motionThreshold: number;
} {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    presenceThreshold: round(Math.min(0.5, Math.max(0.06, noise.presence * 3))),
    motionThreshold: round(Math.min(0.2, Math.max(0.01, noise.motion * 2))),
  };
}

/** Ritmo de la línea en piezas por minuto, con las inspecciones del último minuto. */
export function piecesPerMinute(timestamps: readonly number[], now: number, windowMs = 60_000): number {
  const recent = timestamps.filter((t) => now - t <= windowMs && t <= now).length;
  return Math.round((recent * 60_000) / windowMs);
}
