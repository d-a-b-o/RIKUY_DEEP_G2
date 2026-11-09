"use server";

import { revalidatePath } from "next/cache";
import type { CatalogFormState } from "@/app/panel/catalogos/actions";
import { sendInvitationEmail } from "@/lib/auth/emails";
import { getActionUser } from "@/lib/auth/session";
import { ForbiddenError, ROLE_LABELS } from "@/lib/authz";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { INVITATION_DAYS } from "@/lib/invitations/service";
import { getSiteUrl } from "@/lib/site";
import { invitePlantUser, revokeInvitation, setPlantUserActive, updatePlantUser, UserError } from "@/lib/users/service";

/**
 * Server Actions de HU30 · Usuarios de mi planta (RIKDP-41). Cada operación
 * vuelve a comprobar sesión, permiso y empresa en src/lib/users/service.ts.
 */

const PATH = "/panel/admin/usuarios";

export type InviteState =
  | { status: "idle" }
  | { status: "invited"; email: string; emailSent: boolean; inviteUrl?: string; at: number }
  | { status: "error"; message: string; fields: Record<string, string>; values: Record<string, string> };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.slice(0, 300) : "";
};

const valuesOf = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 300)]));

async function requireUser() {
  if (!isDatabaseConfigured()) throw new UserError("NOT_FOUND", "La base de datos no está configurada");
  const user = await getActionUser();
  if (!user) throw new ForbiddenError("usuarios:gestionar", "NO_AUTENTICADO");
  return user;
}

function failure(error: unknown, values: Record<string, string>) {
  if (error instanceof ForbiddenError) {
    return { status: "error" as const, message: "Tu rol no puede gestionar usuarios.", fields: {}, values };
  }
  if (error instanceof UserError) return { status: "error" as const, message: error.message, fields: error.fields, values };
  console.error("[usuarios] error inesperado", error);
  return { status: "error" as const, message: "No se pudo guardar. Inténtalo de nuevo.", fields: {}, values };
}

/** HU30-T02: invitación por correo con enlace para crear la contraseña. */
export async function inviteUserAction(_previous: InviteState, form: FormData): Promise<InviteState> {
  const values = valuesOf(form);
  try {
    const user = await requireUser();
    const result = await invitePlantUser(getDb(), user, { name: str(form, "name"), email: str(form, "email"), role: str(form, "role") as "INSPECTOR" });
    const url = new URL("/invitacion", getSiteUrl());
    url.searchParams.set("token", result.token);
    const emailSent = await sendInvitationEmail({
      to: result.invitation.email,
      name: result.name,
      companyName: result.companyName,
      url: url.toString(),
      days: INVITATION_DAYS,
      roleLabel: ROLE_LABELS[result.invitation.role],
    });
    revalidatePath(PATH);
    return {
      status: "invited",
      email: result.invitation.email,
      emailSent,
      // Solo si el correo no salió: el administrador puede copiar el enlace y enviarlo él.
      inviteUrl: emailSent ? undefined : url.toString(),
      at: Date.now(),
    };
  } catch (error) {
    return failure(error, values);
  }
}

/** Editar, activar o desactivar usuarios y anular invitaciones. */
export async function userAction(_previous: CatalogFormState, form: FormData): Promise<CatalogFormState> {
  const values = valuesOf(form);
  try {
    const user = await requireUser();
    const db = getDb();
    const id = str(form, "id");
    let message: string;
    switch (str(form, "intent")) {
      case "user:update": {
        const { revokedSessions } = await updatePlantUser(db, user, id, { name: str(form, "name"), role: str(form, "role") as "INSPECTOR" });
        message = revokedSessions > 0 ? "Usuario actualizado. Se cerraron sus sesiones para aplicar el rol nuevo." : "Usuario actualizado.";
        break;
      }
      case "user:toggle": {
        const active = str(form, "active") === "true";
        const { revokedSessions } = await setPlantUserActive(db, user, id, active);
        message = active ? "Usuario activado." : `Usuario desactivado. Se cerraron ${revokedSessions} sesiones.`;
        break;
      }
      case "invitation:revoke":
        await revokeInvitation(db, user, id);
        message = "Invitación anulada.";
        break;
      default:
        throw new UserError("INVALID", "Acción desconocida");
    }
    revalidatePath(PATH);
    return { status: "saved", message, at: Date.now() };
  } catch (error) {
    return failure(error, values);
  }
}
