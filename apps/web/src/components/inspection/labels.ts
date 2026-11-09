/** Textos comunes del historial y del detalle de inspecciones (HU40, HU42). */

export const VERDICT_LABELS = { OK: "OK", DEFECTIVE: "Defectuosa" } as const;

export const SOURCE_LABELS = {
  LINE: "Estación automática",
  CAMERA: "Cámara",
  BATCH: "Lote de fotos",
  UPLOAD: "Foto subida",
} as const;

export const EVENT_LABELS = {
  CREATED: "Registrada",
  CORRECTED: "Veredicto corregido",
  FLAGGED_FOR_RETRAINING: "Marcada para reentrenamiento",
} as const;

export function verdictClass(verdict: "OK" | "DEFECTIVE"): string {
  return verdict === "OK"
    ? "border-ok/40 bg-ok/10 text-ok"
    : "border-defect/40 bg-defect/10 text-defect";
}

export const percent = (value: number) =>
  new Intl.NumberFormat("es-PE", { style: "percent", maximumFractionDigits: 1 }).format(value);
