"use server";

import { isDatabaseConfigured } from "@/lib/db";
import { notifyNewLead } from "@/lib/leads/notify";
import { saveLead } from "@/lib/leads/repository";
import { demoRequestSchema, looksLikeSpam, type DemoRequestField } from "@/lib/leads/schema";

/** Valores enviados, para volver a mostrarlos en el formulario tras la respuesta. */
export type DemoRequestValues = Partial<Record<Exclude<DemoRequestField, "consent">, string>> & { consent?: boolean };

export type DemoRequestState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<DemoRequestField, string>>; values: DemoRequestValues }
  | { status: "unavailable"; values: DemoRequestValues }
  | { status: "error"; values: DemoRequestValues }
  | { status: "sent" }
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
 * Recibe la solicitud de demo de la landing: filtra spam, valida, guarda el lead
 * (RIKDP-115) y avisa al equipo por correo (RIKDP-116).
 *
 * Si el entorno no tiene base de datos, responde "unavailable" para no dar por
 * recibida una solicitud que no se guarda. Un fallo del correo no invalida el lead.
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

  if (!isDatabaseConfigured()) {
    return { status: "unavailable", values: readValues(formData) };
  }

  let lead: { id: string };
  try {
    lead = await saveLead(parsed.data);
  } catch (error) {
    console.error("No se pudo guardar la solicitud de demo", error);
    return { status: "error", values: readValues(formData) };
  }

  await notifyNewLead({ ...parsed.data, id: lead.id });
  return { status: "sent" };
}
