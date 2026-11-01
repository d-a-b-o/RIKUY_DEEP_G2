"use server";

import { demoRequestSchema, looksLikeSpam, type DemoRequestField } from "@/lib/leads/schema";

/** Valores enviados, para volver a mostrarlos en el formulario tras la respuesta. */
export type DemoRequestValues = Partial<Record<Exclude<DemoRequestField, "consent">, string>> & { consent?: boolean };

export type DemoRequestState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<DemoRequestField, string>>; values: DemoRequestValues }
  | { status: "unavailable"; values: DemoRequestValues }
  | { status: "rejected" };

const TEXT_FIELDS = ["name", "email", "company", "role", "phone", "message"] as const;

function readValues(formData: FormData): DemoRequestValues {
  const values: DemoRequestValues = { consent: formData.get("consent") === "on" };
  for (const field of TEXT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.slice(0, 2000);
  }
  return values;
}

/**
 * Valida la solicitud de demo de la landing.
 *
 * Guardar el lead (RIKDP-115) y avisar por correo (RIKDP-116) dependen de la
 * base de datos de HU13. Hasta entonces la acción valida y filtra spam, pero
 * responde "unavailable" para no dar por recibida una solicitud que no se guarda.
 */
export async function requestDemo(_previous: DemoRequestState, formData: FormData): Promise<DemoRequestState> {
  if (
    looksLikeSpam({
      honeypot: formData.get("website"),
      startedAt: formData.get("startedAt"),
      now: Date.now(),
    })
  ) {
    return { status: "rejected" };
  }

  const parsed = demoRequestSchema.safeParse({
    name: formData.get("name") ?? undefined,
    email: formData.get("email") ?? undefined,
    company: formData.get("company") ?? undefined,
    role: formData.get("role") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    message: formData.get("message") ?? undefined,
    consent: formData.get("consent") ?? undefined,
  });

  if (!parsed.success) {
    const errors: Partial<Record<DemoRequestField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as DemoRequestField | undefined;
      if (field && !errors[field]) errors[field] = issue.message;
    }
    return { status: "invalid", errors, values: readValues(formData) };
  }

  return { status: "unavailable", values: readValues(formData) };
}
