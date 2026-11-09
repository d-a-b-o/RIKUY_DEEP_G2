import { z } from "zod";

/** HU31/HU33 · Validación de los catálogos de planta (RIKDP-42, RIKDP-44). */

const code = (label: string, max = 32) =>
  z
    .string()
    .trim()
    .min(1, `Escribe el código de ${label}`)
    .max(max, `Máximo ${max} caracteres`)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, "Usa letras, números, guiones o puntos")
    .transform((v) => v.toUpperCase());

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora con formato HH:MM");

export const partSchema = z.object({
  code: code("la pieza"),
  name: z.string().trim().min(2, "Escribe el nombre de la pieza").max(100, "Máximo 100 caracteres"),
  description: z
    .string()
    .trim()
    .max(300, "Máximo 300 caracteres")
    .optional()
    .transform((v) => v || null),
});

export const moldSchema = z.object({
  partId: z.uuid("Elige la pieza"),
  code: code("el molde"),
  cavities: z.coerce.number().int("Número entero").min(1, "Mínimo 1").max(64, "Máximo 64"),
});

export const batchSchema = z.object({
  moldId: z.uuid("Elige el molde"),
  code: code("el lote", 40),
});

export const shiftSchema = z
  .object({
    name: z.string().trim().min(1, "Escribe el nombre del turno").max(40, "Máximo 40 caracteres"),
    startTime: hhmm,
    endTime: hhmm,
  })
  .refine((s) => s.startTime !== s.endTime, { path: ["endTime"], message: "El turno debe durar algo: la hora de fin no puede ser igual a la de inicio" });

export type PartInput = z.input<typeof partSchema>;
export type MoldInput = z.input<typeof moldSchema>;
export type BatchInput = z.input<typeof batchSchema>;
export type ShiftInput = z.input<typeof shiftSchema>;

/** "HH:MM" → valor para una columna TIME (fecha 1970-01-01 en UTC, como la entrega Prisma). */
export function toTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Tramos [inicio, fin) en minutos del día; un turno que cruza la medianoche da dos tramos. */
function segments(start: string, end: string): [number, number][] {
  const a = toMinutes(start);
  const b = toMinutes(end);
  return a < b ? [[a, b]] : [
    [a, 1440],
    [0, b],
  ];
}

/** Indica si dos turnos se superponen en algún minuto del día. */
export function shiftsOverlap(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  return segments(a.startTime, a.endTime).some(([s1, e1]) => segments(b.startTime, b.endTime).some(([s2, e2]) => s1 < e2 && s2 < e1));
}

/** Errores de zod como { campo: mensaje } para mostrarlos junto a cada campo. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
