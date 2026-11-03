/**
 * Reglas de negocio de la trazabilidad (HU24), sin acceso a datos para poder
 * probarlas aisladas. La numeración sigue docs/arquitectura/modelo-datos.md,
 * «Reglas de negocio que el esquema debe garantizar».
 */

export type Role = "SUPERADMIN" | "ADMIN" | "INSPECTOR" | "VIEWER" | "STATION";
export type InspectionSource = "LINE" | "CAMERA" | "BATCH" | "UPLOAD";
export type Verdict = "OK" | "DEFECTIVE";

/** Roles que registran inspecciones manuales (cámara, lote o subida). */
const MANUAL_INSPECTION_ROLES: readonly Role[] = ["ADMIN", "INSPECTOR"];
/** Roles que corrigen veredictos (HU40). */
const CORRECTION_ROLES: readonly Role[] = ["ADMIN", "INSPECTOR"];
/** Roles que consultan el detalle de una inspección de su empresa. */
const TRACE_READER_ROLES: readonly Role[] = ["ADMIN", "INSPECTOR", "VIEWER"];

/**
 * Regla 8 y 10: una estación solo registra con origen LINE; las personas, solo
 * inspecciones manuales. El superadministrador no pertenece a ninguna empresa.
 */
export function canRecord(role: Role, source: InspectionSource): boolean {
  if (role === "STATION") return source === "LINE";
  return MANUAL_INSPECTION_ROLES.includes(role) && source !== "LINE";
}

export function canCorrect(role: Role): boolean {
  return CORRECTION_ROLES.includes(role);
}

export function canReadTrace(role: Role): boolean {
  return TRACE_READER_ROLES.includes(role);
}

/**
 * Regla 9: la foto es obligatoria en las inspecciones manuales y en las
 * defectuosas. En las OK de una estación es opcional: la estación guarda 1 de
 * cada `okPhotoEvery` (ver shouldKeepOkPhoto).
 */
export function isImageRequired(source: InspectionSource, verdict: Verdict): boolean {
  return source !== "LINE" || verdict === "DEFECTIVE";
}

export const DEFAULT_OK_PHOTO_EVERY = 20;

/** Lee `okPhotoEvery` de `station.config`, con el valor por defecto del ADR 0007. */
export function okPhotoEveryFromConfig(config: unknown): number {
  const value = (config as { okPhotoEvery?: unknown } | null)?.okPhotoEvery;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_OK_PHOTO_EVERY;
}

/**
 * Para la estación: indica si se guarda la foto de una pieza OK. `okSinceLastPhoto`
 * cuenta las OK desde la última foto OK guardada, incluida la actual (1, 2, …).
 * Se guarda la número N; las defectuosas siempre se guardan aparte.
 */
export function shouldKeepOkPhoto(okSinceLastPhoto: number, okPhotoEvery: number): boolean {
  if (!Number.isInteger(okSinceLastPhoto) || okSinceLastPhoto < 1) throw new RangeError("okSinceLastPhoto debe ser ≥ 1");
  if (!Number.isInteger(okPhotoEvery) || okPhotoEvery < 1) throw new RangeError("okPhotoEvery debe ser ≥ 1");
  return okSinceLastPhoto >= okPhotoEvery;
}

// ─── Turno activo (regla 5) ────────────────────────────────────────────────

export type ShiftWindow = {
  id: string;
  /** Hora local de la empresa. Prisma devuelve las columnas TIME como Date en 1970-01-01 UTC. */
  startTime: Date;
  endTime: Date;
};

const minutesOfTime = (time: Date) => time.getUTCHours() * 60 + time.getUTCMinutes();

/** Minuto del día (0–1439) de `instant` en la zona horaria de la empresa. */
export function localMinuteOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

/** Un turno está activo si start <= h < end o, si cruza la medianoche, si h >= start o h < end. */
export function isShiftActiveAt(shift: ShiftWindow, minuteOfDay: number): boolean {
  const start = minutesOfTime(shift.startTime);
  const end = minutesOfTime(shift.endTime);
  if (start === end) return false;
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

/** Turno activo de la empresa en el instante dado, o null si ninguno cubre esa hora. */
export function findActiveShift<T extends ShiftWindow>(shifts: readonly T[], instant: Date, timeZone: string): T | null {
  const minute = localMinuteOfDay(instant, timeZone);
  return shifts.find((shift) => isShiftActiveAt(shift, minute)) ?? null;
}
