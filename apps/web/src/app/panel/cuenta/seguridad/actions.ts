"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { authorize, ForbiddenError } from "@/lib/authz";
import { getAuth } from "@/lib/auth/server";
import { getCurrentUser, toAuthzUser } from "@/lib/auth/session";
import { SECURITY_PATH } from "@/lib/auth/config";
import { getDb } from "@/lib/db";

/**
 * Tras activar o desactivar la verificación en dos pasos se cierran las demás
 * sesiones de la cuenta (HU29): la sesión actual ya es nueva.
 */
export async function revokeOtherSessionsAction(): Promise<{ ok: boolean }> {
  try {
    await getAuth().api.revokeOtherSessions({ headers: await headers() });
    revalidatePath(SECURITY_PATH);
    return { ok: true };
  } catch (error) {
    console.error("[2fa] no se pudieron cerrar las otras sesiones", error);
    return { ok: false };
  }
}

export type PolicyState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

/** El administrador de planta exige (o deja de exigir) 2FA a toda su empresa (HU29, criterio 3). */
export async function setCompanyTwoFactorPolicyAction(_previous: PolicyState, formData: FormData): Promise<PolicyState> {
  const user = await getCurrentUser(SECURITY_PATH);
  const required = formData.get("requireTwoFactor") === "on";
  try {
    if (!user.companyId) throw new ForbiddenError("usuarios:gestionar", "SIN_PERMISO");
    await authorize(toAuthzUser(user), "usuarios:gestionar", { empresaId: user.companyId, path: "setCompanyTwoFactorPolicy" });
    if (required && !user.twoFactorEnabled) {
      return { status: "error", message: "Activa primero tu propia verificación en dos pasos." };
    }
    await getDb().company.update({ where: { id: user.companyId }, data: { requireTwoFactor: required } });
    revalidatePath(SECURITY_PATH);
    return {
      status: "saved",
      message: required
        ? "Listo: todas las personas de tu planta deberán activar la verificación en dos pasos al entrar."
        : "La verificación en dos pasos vuelve a ser opcional en tu planta.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: "error", message: "Tu rol no puede cambiar esta política." };
    console.error("[2fa] error al cambiar la política", error);
    return { status: "error", message: "No se pudo guardar. Inténtalo de nuevo." };
  }
}
