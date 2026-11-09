import { z } from "zod";

/**
 * Validación de los formularios de empresas (HU23). No importa nada del
 * servidor: la usan las Server Actions y sus pruebas.
 */

/** Zonas horarias que ofrece el formulario. Las plantas del piloto están en Perú. */
export const COMPANY_TIMEZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Guayaquil",
  "America/La_Paz",
  "America/Santiago",
  "America/Mexico_City",
] as const;

export const companySchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre de la empresa").max(120, "Máximo 120 caracteres"),
  /** RUC peruano: 11 dígitos. Opcional en el piloto. */
  taxId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || /^\d{11}$/.test(value), "El RUC tiene 11 dígitos"),
  timezone: z.enum(COMPANY_TIMEZONES, "Elige una zona horaria de la lista"),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const adminInviteSchema = z.object({
  adminName: z.string().trim().min(2, "Escribe el nombre del administrador").max(120, "Máximo 120 caracteres"),
  adminEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("Escribe un correo válido")),
});
export type AdminInviteInput = z.infer<typeof adminInviteSchema>;

export const newCompanySchema = companySchema.extend(adminInviteSchema.shape);
export type NewCompanyInput = z.infer<typeof newCompanySchema>;

export type CompanyField = keyof NewCompanyInput;

/** Primer mensaje de error de cada campo, para mostrarlo junto al campo. */
export function fieldErrors<F extends string>(error: z.ZodError): Partial<Record<F, string>> {
  const errors: Partial<Record<F, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as F | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** Aceptación de una invitación: la persona solo elige su nombre y su contraseña. */
export function acceptInvitationSchema(limits: { min: number; max: number }) {
  return z
    .object({
      name: z.string().trim().min(2, "Escribe tu nombre").max(120, "Máximo 120 caracteres"),
      password: z
        .string()
        .min(limits.min, `La contraseña debe tener al menos ${limits.min} caracteres`)
        .max(limits.max, `La contraseña no puede tener más de ${limits.max} caracteres`),
      confirm: z.string(),
    })
    .refine((data) => data.password === data.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });
}
export type AcceptInvitationField = "name" | "password" | "confirm";
