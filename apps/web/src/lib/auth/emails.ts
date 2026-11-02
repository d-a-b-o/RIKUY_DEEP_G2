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
