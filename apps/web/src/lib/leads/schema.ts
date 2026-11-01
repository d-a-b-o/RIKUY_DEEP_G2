import { z } from "zod";

/** Tiempo mínimo (ms) entre que se muestra el formulario y se envía. Un bot suele enviarlo al instante. */
export const MIN_FILL_TIME_MS = 3000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .optional()
    .transform((value) => (value ? value : undefined));

export const demoRequestSchema = z.object({
  name: z
    .string({ error: "Escribe tu nombre" })
    .trim()
    .min(2, { error: "Escribe tu nombre" })
    .max(120, { error: "Máximo 120 caracteres" }),
  email: z
    .string({ error: "Escribe tu correo" })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Escribe un correo válido, por ejemplo nombre@empresa.com" }))
    .refine((value) => value.length <= 254, { error: "El correo es demasiado largo" }),
  company: z
    .string({ error: "Escribe el nombre de tu empresa" })
    .trim()
    .min(2, { error: "Escribe el nombre de tu empresa" })
    .max(160, { error: "Máximo 160 caracteres" }),
  role: optionalText(120),
  phone: z
    .string()
    .trim()
    .max(30, { error: "Máximo 30 caracteres" })
    .refine((value) => value === "" || /^\+?[0-9 ()-]{6,30}$/.test(value), {
      error: "Escribe solo números, espacios, paréntesis, guiones y un + inicial",
    })
    .optional()
    .transform((value) => (value ? value : undefined)),
  message: optionalText(1000),
  consent: z.literal("on", { error: "Necesitamos tu autorización para contactarte" }),
});

export type DemoRequest = z.infer<typeof demoRequestSchema>;
export type DemoRequestField = keyof DemoRequest;

export type SpamCheck = {
  /** Campo trampa oculto: una persona lo deja vacío. */
  honeypot: FormDataEntryValue | null;
  /** Momento (ms) en que se mostró el formulario. */
  startedAt: FormDataEntryValue | null;
  now: number;
};

/** Devuelve true si el envío parece automático. */
export function looksLikeSpam({ honeypot, startedAt, now }: SpamCheck): boolean {
  if (typeof honeypot === "string" && honeypot.trim() !== "") return true;
  const started = Number(startedAt);
  if (!Number.isFinite(started) || started <= 0) return true;
  const elapsed = now - started;
  return elapsed < MIN_FILL_TIME_MS || elapsed > 24 * 60 * 60 * 1000;
}
