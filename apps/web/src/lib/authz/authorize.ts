/**
 * HU32 · Acceder según mi rol (RIKDP-43) — helper de autorización.
 *
 * Uso en una server action o ruta de API:
 *
 *   const user = await getSessionUser();               // HU19 · Better Auth
 *   await authorize(user, "catalogos:gestionar", { empresaId });
 *
 * Si no tiene permiso lanza ForbiddenError (status 403) y registra el intento
 * con el registrador configurado. En el servidor, src/instrumentation.ts instala
 * el que guarda en la tabla access_denied_log (HU32-T03, ./denied-log.ts).
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
  /** Método HTTP (GET, POST…). Sin indicar, se trata de una server action o un servicio. */
  method?: string;
  /** IP de origen. El registrador guarda solo su hash (HU32-T03). */
  ip?: string | null;
  at: Date;
}

export type DeniedAccessLogger = (entry: DeniedAccess) => void | Promise<void>;

/** Datos de la petición que se guardan junto al intento denegado. */
export interface RequestInfo {
  path?: string;
  method?: string;
  ip?: string | null;
}

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

const consoleLogger: DeniedAccessLogger = (entry) => {
  console.warn("[authz] acceso denegado", JSON.stringify(entry));
};

/**
 * El registrador vive en globalThis y no en una variable del módulo: Next.js
 * empaqueta instrumentation.ts, las páginas y las server actions por separado,
 * y cada paquete tendría su propia copia de este archivo. Así, el registrador
 * que instala src/instrumentation.ts lo usan todos.
 */
const LOGGER_KEY = Symbol.for("rikuydeep.authz.deniedAccessLogger");
const loggerHolder = globalThis as unknown as Record<symbol, DeniedAccessLogger | undefined>;

function currentLogger(): DeniedAccessLogger {
  return loggerHolder[LOGGER_KEY] ?? consoleLogger;
}

/** Reemplaza el registrador de accesos denegados (p. ej. para guardarlos en la base de datos). */
export function setDeniedAccessLogger(next: DeniedAccessLogger): void {
  loggerHolder[LOGGER_KEY] = next;
}

/** Registra un intento denegado sin propagar errores: un fallo al registrar nunca abre el acceso. */
export async function logDeniedAccess(entry: DeniedAccess, logger: DeniedAccessLogger = currentLogger()): Promise<void> {
  try {
    await logger(entry);
  } catch (error) {
    console.error("[authz] no se pudo registrar el acceso denegado", error);
  }
}

/** Datos que se registran cuando `check` deniega. */
export function deniedEntry(
  user: AuthzUser | null | undefined,
  permission: Permission,
  reason: DenialReason,
  request: RequestInfo = {},
): DeniedAccess {
  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    permission,
    reason,
    empresaId: user?.empresaId ?? null,
    path: request.path,
    method: request.method,
    ip: request.ip,
    at: new Date(),
  };
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
  target: AuthzTarget & RequestInfo = {},
): Promise<void> {
  const decision = check(user, permission, target);
  if (decision.allowed) return;

  const reason = decision.reason ?? "SIN_PERMISO";
  await logDeniedAccess(deniedEntry(user, permission, reason, target));
  throw new ForbiddenError(permission, reason);
}

/** Respuesta 403 estándar para rutas de API (Route Handlers de Next.js). */
export function forbiddenResponse(error: ForbiddenError): Response {
  return Response.json({ error: "forbidden", permission: error.permission }, { status: 403 });
}
