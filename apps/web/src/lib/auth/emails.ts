import "server-only";
import { Resend } from "resend";
import { RESET_PASSWORD_TOKEN_MINUTES } from "./config";

type PasswordResetEmail = { to: string; name: string; url: string };

/**
 * Envía el enlace para restablecer la contraseña (RIKDP-137).
 *
 * Sin Resend configurado no se envía nada. En desarrollo el enlace se escribe
 * en la consola para poder probar el flujo; en producción solo queda un aviso,
 * porque el enlace da acceso a la cuenta.
 */
export async function sendPasswordResetEmail({ to, name, url }: PasswordResetEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.warn("Recuperación de contraseña pedida, pero RESEND_API_KEY no está configurada.");
    } else {
      console.info(`[desarrollo] Enlace para restablecer la contraseña de ${to}: ${url}`);
    }
    return;
  }

  const from = process.env.AUTH_EMAIL_FROM ?? process.env.LEAD_NOTIFICATION_FROM ?? "RikuyDeep <onboarding@resend.dev>";
  const text = [
    `Hola, ${name}:`,
    "",
    "Recibimos una solicitud para restablecer tu contraseña de RikuyDeep.",
    "Abre este enlace para elegir una nueva:",
    "",
    url,
    "",
    `El enlace vence en ${RESET_PASSWORD_TOKEN_MINUTES} minutos y solo se puede usar una vez.`,
    "Al cambiar la contraseña se cerrarán todas tus sesiones abiertas.",
    "",
    "Si no lo pediste, ignora este correo: tu contraseña no cambia.",
  ].join("\n");

  const { error } = await new Resend(apiKey).emails.send({
    from,
    to,
    subject: "Restablece tu contraseña de RikuyDeep",
    text,
  });
  // No se relanza: la respuesta al usuario debe ser la misma exista o no la cuenta.
  if (error) console.error("No se pudo enviar el correo de recuperación", error.message);
}

type InvitationEmail = {
  to: string;
  name: string;
  companyName: string;
  url: string;
  days: number;
  /** Rol de la cuenta (HU30). Sin indicar, la invitación es para administrar la empresa (HU23). */
  roleLabel?: string;
};

/**
 * Envía la invitación a crear la cuenta (HU23-T02). Devuelve false si no se
 * pudo enviar, para que la pantalla ofrezca copiar el enlace.
 */
export async function sendInvitationEmail({ to, name, companyName, url, days, roleLabel }: InvitationEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[desarrollo] Invitación para ${to}: ${url}`);
    }
    return false;
  }

  const from = process.env.AUTH_EMAIL_FROM ?? process.env.LEAD_NOTIFICATION_FROM ?? "RikuyDeep <onboarding@resend.dev>";
  const text = [
    `Hola, ${name}:`,
    "",
    roleLabel
      ? `Te invitamos a usar RikuyDeep en ${companyName} como ${roleLabel}. RikuyDeep es la plataforma de inspección de piezas de fundición.`
      : `Te invitamos a administrar ${companyName} en RikuyDeep, la plataforma de inspección de piezas de fundición.`,
    "Abre este enlace para crear tu cuenta y elegir tu contraseña:",
    "",
    url,
    "",
    `El enlace vence en ${days} días y solo se puede usar una vez.`,
    "Si no esperabas esta invitación, ignora este correo.",
  ].join("\n");

  const { error } = await new Resend(apiKey).emails.send({
    from,
    to,
    subject: roleLabel ? `Invitación a RikuyDeep en ${companyName}` : `Invitación para administrar ${companyName} en RikuyDeep`,
    text,
  });
  if (error) {
    console.error("No se pudo enviar la invitación", error.message);
    return false;
  }
  return true;
}
