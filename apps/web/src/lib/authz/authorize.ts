/**
 * HU32 · Acceder según mi rol (RIKDP-43) — helper de autorización.
 *
 * Uso en una server action o ruta de API:
 *
 *   const user = await getSessionUser();               // HU19 · Better Auth
 *   await authorize(user, "catalogos:gestionar", { empresaId });
 *
 * Si no tiene permiso lanza ForbiddenError (status 403) y registra el intento
 * con el registrador configurado (HU32-T03 lo conectará a Prisma).
 */
import { isRole, ROLE_PERMISSIONS, type Permission, type Role } from "./roles";

export interface AuthzUser {
  id: string;
  role: Role;
  /** Empresa a la que pertenece. El Superadmin puede no tener una. */
  empresaId: string | null;
}

export interface AuthzTarget {
  /** Empresa dueña del recurso. Si se indica, se exige que coincida con la del usuario. */
  empresaId?: string | null;
}

export type DenialReason = "NO_AUTENTICADO" | "ROL_INVALIDO" | "SIN_PERMISO" | "OTRA_EMPRESA";

export interface DeniedAccess {
  userId: string | null;
  role: string | null;
  permission: Permission;
  reason: DenialReason;
  empresaId: string | null;
  /** Ruta o acción que se intentó usar, p. ej. "/catalogos" o "crearPieza". */
  path?: string;
  at: Date;
}

export type DeniedAccessLogger = (entry: DeniedAccess) => void | Promise<void>;

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(
    readonly permission: Permission,
    readonly reason: DenialReason,
  ) {
    super(`Acceso denegado: falta el permiso ${permission} (${reason})`);
    this.name = "ForbiddenError";
  }
}

let logger: DeniedAccessLogger = (entry) => {
  console.warn("[authz] acceso denegado", JSON.stringify(entry));
};

/** Reemplaza el registrador de accesos denegados (p. ej. para guardarlos en la base de datos). */
export function setDeniedAccessLogger(next: DeniedAccessLogger): void {
  logger = next;
}

export interface Decision {
  allowed: boolean;
  reason?: DenialReason;
}

/** Decide sin efectos secundarios. Úsalo para mostrar u ocultar elementos de la interfaz. */
export function check(
  user: AuthzUser | null | undefined,
  permission: Permission,
  target: AuthzTarget = {},
): Decision {
  if (!user) return { allowed: false, reason: "NO_AUTENTICADO" };
  if (!isRole(user.role)) return { allowed: false, reason: "ROL_INVALIDO" };
  if (!ROLE_PERMISSIONS[user.role].includes(permission)) return { allowed: false, reason: "SIN_PERMISO" };

  const recursoTieneEmpresa = target.empresaId !== undefined && target.empresaId !== null;
  if (user.role !== "SUPERADMIN" && recursoTieneEmpresa && target.empresaId !== user.empresaId) {
    return { allowed: false, reason: "OTRA_EMPRESA" };
  }
  return { allowed: true };
}

export function can(user: AuthzUser | null | undefined, permission: Permission, target?: AuthzTarget): boolean {
  return check(user, permission, target).allowed;
}

/**
 * Exige el permiso. Si falta, registra el intento y lanza ForbiddenError (403).
 * Llamarlo en el servidor: middleware, server actions y rutas de API.
 */
export async function authorize(
  user: AuthzUser | null | undefined,
  permission: Permission,
  target: AuthzTarget & { path?: string } = {},
): Promise<void> {
  const decision = check(user, permission, target);
  if (decision.allowed) return;

  const reason = decision.reason ?? "SIN_PERMISO";
  try {
    await logger({
      userId: user?.id ?? null,
      role: user?.role ?? null,
      permission,
      reason,
      empresaId: user?.empresaId ?? null,
      path: target.path,
      at: new Date(),
    });
  } catch (error) {
    // Un fallo al registrar nunca debe convertir un 403 en acceso permitido.
    console.error("[authz] no se pudo registrar el acceso denegado", error);
  }
  throw new ForbiddenError(permission, reason);
}

/** Respuesta 403 estándar para rutas de API (Route Handlers de Next.js). */
export function forbiddenResponse(error: ForbiddenError): Response {
  return Response.json({ error: "forbidden", permission: error.permission }, { status: 403 });
}
