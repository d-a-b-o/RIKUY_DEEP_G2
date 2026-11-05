import "server-only";
import { Resend } from "resend";
import type { DemoRequest } from "./schema";

export type NotifyResult = "sent" | "skipped" | "failed";

/**
 * Avisa al equipo comercial de una nueva solicitud de demo (RIKDP-116).
 * Si Resend no está configurado, no envía nada: el lead ya quedó guardado.
 * El correo es de texto plano para no interpretar como HTML lo que escribió el visitante.
 */
export async function notifyNewLead(lead: DemoRequest & { id: string }): Promise<NotifyResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFICATION_TO;
  if (!apiKey || !to) return "skipped";

  const from = process.env.LEAD_NOTIFICATION_FROM ?? "RikuyDeep <onboarding@resend.dev>";
  const lines = [
    "Nueva solicitud de demo en la landing de RikuyDeep.",
    "",
    `Nombre: ${lead.name}`,
    `Correo: ${lead.email}`,
    `Empresa: ${lead.company}`,
    `Cargo: ${lead.role ?? "—"}`,
    `Teléfono: ${lead.phone ?? "—"}`,
    "",
    "Mensaje:",
    lead.message ?? "—",
    "",
    `Lead: ${lead.id}`,
  ];

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: to.split(",").map((address) => address.trim()),
      replyTo: lead.email,
      subject: `Solicitud de demo: ${lead.company}`,
      text: lines.join("\n"),
    });
    if (error) {
      console.error("No se pudo enviar el aviso del lead", lead.id, error.message);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("No se pudo enviar el aviso del lead", lead.id, error);
    return "failed";
  }
}
