import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { authorize, clientIp, ForbiddenError, type AuthzUser, type Permission } from "@/lib/authz";
import { SIGN_IN_PATH } from "./config";
import { getSession } from "./server";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
};

/** Usuario de la sesión, o null. No redirige: para piezas de interfaz como el menú. */
export async function getOptionalUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      companyId: true,
      company: { select: { name: true, status: true } },
    },
  });
  // Cuenta desactivada o empresa desactivada (HU23, criterio 3): sin acceso.
  if (!user?.active || user.company?.status === "INACTIVE") return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    companyName: user.company?.name ?? null,
  };
}

/**
 * Usuario de la sesión actual para las páginas privadas (capa de acceso a datos).
 * Sin sesión válida, con la cuenta desactivada o con la empresa desactivada,
 * redirige al login.
 */
export async function getCurrentUser(nextPath: string): Promise<CurrentUser> {
  const user = await getOptionalUser();
  if (!user) redirect(`${SIGN_IN_PATH}?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/** Usuario de la sesión para Server Actions: null en lugar de redirigir. */
export async function getActionUser(): Promise<AuthzUser | null> {
  const user = await getOptionalUser();
  return user ? toAuthzUser(user) : null;
}

/** Forma que espera src/lib/authz. Un rol desconocido se rechaza allí como ROL_INVALIDO. */
export function toAuthzUser(user: Pick<CurrentUser, "id" | "role" | "companyId">): AuthzUser {
  return { id: user.id, role: user.role as AuthzUser["role"], empresaId: user.companyId };
}

/**
 * Usuario de la página y si tiene el permiso. Un acceso denegado se registra
 * (HU32) y la página muestra el aviso en lugar del contenido.
 */
export async function getPageAccess(
  nextPath: string,
  permission: Permission,
): Promise<{ user: CurrentUser; allowed: boolean }> {
  const user = await getCurrentUser(nextPath);
  try {
    await authorize(toAuthzUser(user), permission, { path: nextPath, method: "GET", ip: clientIp(await headers()) });
    return { user, allowed: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { user, allowed: false };
    throw error;
  }
}
