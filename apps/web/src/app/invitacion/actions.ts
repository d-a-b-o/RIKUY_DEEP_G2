"use server";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/config";
import { acceptInvitationSchema, fieldErrors, type AcceptInvitationField } from "@/lib/companies/schema";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { acceptInvitation, InvitationError } from "@/lib/invitations/service";

export type AcceptInvitationState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<AcceptInvitationField, string>>; name: string }
  | { status: "error"; message: string; name: string }
  | { status: "accepted"; email: string };

const MESSAGES: Record<InvitationError["code"], string> = {
  INVALID: "El enlace no es válido. Pide al equipo de RikuyDeep que te envíe uno nuevo.",
  EXPIRED: "La invitación venció. Pide al equipo de RikuyDeep que te envíe una nueva.",
  USED: "Esta invitación ya se usó. Si ya tienes cuenta, ingresa con tu correo.",
  COMPANY_INACTIVE: "La empresa de esta invitación está desactivada.",
  EMAIL_IN_USE: "Ya existe una cuenta con este correo. Ingresa o recupera tu contraseña.",
};

/** Crea la cuenta a partir de la invitación (HU23-T02). */
export async function acceptInvitationAction(
  _previous: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").slice(0, 200);
  const parsed = acceptInvitationSchema({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }).safeParse({
    name,
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { status: "invalid", errors: fieldErrors<AcceptInvitationField>(parsed.error), name };
  if (!isDatabaseConfigured()) return { status: "error", message: "El servicio no está disponible.", name };

  try {
    const user = await acceptInvitation(getDb(), { token, name: parsed.data.name, password: parsed.data.password });
    return { status: "accepted", email: user.email };
  } catch (error) {
    if (error instanceof InvitationError) return { status: "error", message: MESSAGES[error.code], name };
    console.error("[invitaciones] error inesperado", error);
    return { status: "error", message: "No pudimos crear tu cuenta. Inténtalo de nuevo en unos minutos.", name };
  }
}
