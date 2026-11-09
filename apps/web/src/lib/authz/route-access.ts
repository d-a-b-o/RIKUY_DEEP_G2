import "server-only";
import { check, deniedEntry, logDeniedAccess, type AuthzUser, type DeniedAccessLogger } from "./authorize";
import type { Permission } from "./roles";
import { clientIp } from "./request";
import { FORBIDDEN_PATH, requiredPermission } from "./routes";

/**
 * HU32-T02 (RIKDP-180): decisión del proxy para una ruta del panel.
 * Separada de src/proxy.ts para probarla sin levantar Next.js.
 */

export type RouteAccess =
  | { allowed: true }
  | { allowed: false; permission: Permission; forbiddenPath: string };

export interface RouteRequest {
  pathname: string;
  method: string;
  headers: Headers;
}

export interface RouteAccessDeps {
  /** Usuario de la sesión, o null si no hay sesión válida. */
  loadUser: (headers: Headers) => Promise<AuthzUser | null>;
  /** Registrador de intentos denegados. */
  logger: DeniedAccessLogger;
}

const ALLOWED: RouteAccess = { allowed: true };

async function loadSessionUser(headers: Headers): Promise<AuthzUser | null> {
  const { getAuth } = await import("@/lib/auth/server");
  // disableRefresh: el proxy solo lee la sesión; renovarla es cosa de las páginas.
  const session = await getAuth().api.getSession({ headers, query: { disableRefresh: true } });
  if (!session || session.user.active === false) return null;
  return {
    id: session.user.id,
    role: session.user.role as AuthzUser["role"],
    empresaId: session.user.companyId ?? null,
  };
}

async function defaultDeps(): Promise<RouteAccessDeps> {
  const [{ createDbDeniedAccessLogger }, { getDb }] = await Promise.all([import("./denied-log"), import("@/lib/db")]);
  return { loadUser: loadSessionUser, logger: createDbDeniedAccessLogger(getDb) };
}

export async function checkRouteAccess(request: RouteRequest, deps?: RouteAccessDeps): Promise<RouteAccess> {
  const permission = requiredPermission(request.pathname);
  if (!permission) return ALLOWED;
  // Sin base de datos no hay sesiones que leer (p. ej. en `next build`); la página decide.
  if (!deps && !process.env.DATABASE_URL) return ALLOWED;

  const { loadUser, logger } = deps ?? (await defaultDeps());
  let user: AuthzUser | null;
  try {
    user = await loadUser(request.headers);
  } catch (error) {
    console.error("[proxy] no se pudo leer la sesión", error);
    return ALLOWED; // La página vuelve a comprobar la sesión y el permiso.
  }
  // Sesión vencida o cuenta desactivada: la página lleva al login.
  if (!user) return ALLOWED;

  const decision = check(user, permission);
  if (decision.allowed) return ALLOWED;

  await logDeniedAccess(
    deniedEntry(user, permission, decision.reason ?? "SIN_PERMISO", {
      path: request.pathname,
      method: request.method,
      ip: clientIp(request.headers),
    }),
    logger,
  );
  return { allowed: false, permission, forbiddenPath: FORBIDDEN_PATH };
}
