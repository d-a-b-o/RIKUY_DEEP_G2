import { z } from "zod";

/** Tolerancia para relojes adelantados en los navegadores de planta. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** La estación puede sincronizar tarde si estuvo sin red (HU44), pero no indefinidamente. */
export const MAX_CAPTURE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const probability = z.number().min(0).max(1);

/**
 * Datos que envía el navegador para registrar una inspección. El servidor no
 * confía en el contexto: empresa, autor, molde y pieza los deduce él (ADR 0003, 0004).
 */
export const recordInspectionSchema = z.object({
  /** Identificador generado por el cliente: hace idempotentes los reintentos (HU35, HU44). */
  clientId: z.uuid().optional(),
  batchId: z.uuid(),
  /** Si falta, se usa el turno activo de la empresa a la hora de captura (regla 5). */
  shiftId: z.uuid().optional(),
  source: z.enum(["LINE", "CAMERA", "BATCH", "UPLOAD"]),
  modelVersion: z.string().trim().min(1).max(64),
  predictedVerdict: z.enum(["OK", "DEFECTIVE"]),
  confidence: probability,
  thresholdApplied: z.number().gt(0).lt(1),
  imageKey: z.string().max(200).optional(),
  imageSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "SHA-256 en hexadecimal")
    .optional(),
  pieceNumber: z.number().int().min(1).max(10_000_000).optional(),
  inferenceMs: z.number().int().min(0).max(60_000).optional(),
  backend: z.enum(["WEBGL", "WASM"]).optional(),
  warnings: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  capturedAt: z.coerce.date(),
});

export type RecordInspectionInput = z.input<typeof recordInspectionSchema>;
export type RecordInspectionData = z.output<typeof recordInspectionSchema>;

export const correctVerdictSchema = z.object({
  inspectionId: z.uuid(),
  newVerdict: z.enum(["OK", "DEFECTIVE"]),
  reason: z.string().trim().min(3, "Explica el motivo de la corrección").max(500),
});

export type CorrectVerdictInput = z.input<typeof correctVerdictSchema>;

/** Comprueba que la hora de captura sea plausible respecto de `now`. */
export function isPlausibleCaptureTime(capturedAt: Date, now: Date): boolean {
  const delta = now.getTime() - capturedAt.getTime();
  return delta >= -MAX_CLOCK_SKEW_MS && delta <= MAX_CAPTURE_AGE_MS;
}
