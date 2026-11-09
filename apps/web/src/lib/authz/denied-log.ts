import "server-only";
import { createHmac } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser, type DeniedAccess, type DeniedAccessLogger, type DenialReason } from "./authorize";
import { PERMISSIONS, type Permission } from "./roles";

/**
 * HU32-T03 · Registro de accesos denegados (RIKDP-181).
 *
 * Cada intento denegado (proxy, páginas, server actions y servicios) se guarda
 * en la tabla access_denied_log. Admin de planta y Superadmin lo consultan en
 * /panel/admin/auditoria con el permiso `auditoria:ver`.
 */

/** Valor de `method` cuando el intento no viene de una petición HTTP directa. */
export const ACTION_METHOD = "ACTION";

const SEPARATOR = " · ";
const REASONS: readonly DenialReason[] = ["NO_AUTENTICADO", "ROL_INVALIDO", "SIN_PERMISO", "OTRA_EMPRESA"];

/**
 * Hash de la IP con una clave del servidor: permite ver si varios intentos vienen
 * del mismo origen sin guardar la IP (dato personal).
 */
export function hashIp(ip: string | null | undefined, secret: string): string | null {
  const value = ip?.trim();
  if (!value) return null;
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

export type DeniedAccessRow = {
  userId: string | null;
  companyId: string | null;
  method: string;
  path: string;
  action: string;
  ipHash: string | null;
};

/** Convierte el intento denegado en una fila de access_denied_log. */
export function toDeniedAccessRow(entry: DeniedAccess, secret: string): DeniedAccessRow {
  return {
    userId: entry.userId,
    companyId: entry.empresaId,
    method: (entry.method ?? ACTION_METHOD).toUpperCase().slice(0, 16),
    path: (entry.path ?? "(sin ruta)").slice(0, 500),
    // La tabla no tiene columnas propias para el permiso y el motivo; van juntos aquí.
    action: `${entry.permission}${SEPARATOR}${entry.reason}`,
    ipHash: hashIp(entry.ip, secret),
  };
}

/** Lee el permiso y el motivo guardados por toDeniedAccessRow. */
export function parseDeniedAction(action: string | null): { permission: Permission | null; reason: DenialReason | null } {
  const [permission, reason] = (action ?? "").split(SEPARATOR);
  return {
    permission: (PERMISSIONS as readonly string[]).includes(permission) ? (permission as Permission) : null,
    reason: (REASONS as readonly string[]).includes(reason) ? (reason as DenialReason) : null,
  };
}

function serverSecret(): string {
  return process.env.BETTER_AUTH_SECRET ?? "rikuydeep-sin-secreto";
}

/** Registrador que guarda en la base de datos. Recibe el cliente de forma diferida. */
export function createDbDeniedAccessLogger(getDb: () => PrismaClient, secret = serverSecret()): DeniedAccessLogger {
  return async (entry) => {
    const row = toDeniedAccessRow(entry, secret);
    const db = getDb();
    try {
      await db.accessDeniedLog.create({ data: row });
    } catch (error) {
      // Si el usuario ya no existe, la clave foránea falla: se guarda el intento sin él.
      if (!row.userId) throw error;
      await db.accessDeniedLog.create({ data: { ...row, userId: null } });
    }
  };
}

export type DeniedAccessView = {
  id: string;
  createdAt: Date;
  method: string;
  path: string;
  permission: Permission | null;
  reason: DenialReason | null;
  userName: string | null;
  userEmail: string | null;
  companyName: string | null;
  /** Primeros caracteres del hash: suficiente para agrupar intentos del mismo origen. */
  origin: string | null;
};

export const DENIED_ACCESS_PAGE_SIZE = 50;

/**
 * Últimos accesos denegados. El Admin de planta ve solo los de su empresa; el
 * Superadmin, los de todas (incluidos los intentos sin sesión).
 */
export async function listDeniedAccesses(
  db: PrismaClient,
  actor: AuthzUser,
  { limit = DENIED_ACCESS_PAGE_SIZE }: { limit?: number } = {},
): Promise<DeniedAccessView[]> {
  await authorize(actor, "auditoria:ver", { path: "listDeniedAccesses" });
  if (actor.role !== "SUPERADMIN" && !actor.empresaId) return [];

  const rows = await db.accessDeniedLog.findMany({
    where: actor.role === "SUPERADMIN" ? {} : { companyId: actor.empresaId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      createdAt: true,
      method: true,
      path: true,
      action: true,
      ipHash: true,
      companyId: true,
      user: { select: { name: true, email: true } },
    },
  });

  const companyIds = [...new Set(rows.map((r) => r.companyId).filter((id): id is string => Boolean(id)))];
  const companies = companyIds.length
    ? await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    : [];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    method: row.method,
    path: row.path,
    ...parseDeniedAction(row.action),
    userName: row.user?.name ?? null,
    userEmail: row.user?.email ?? null,
    companyName: row.companyId ? (companyName.get(row.companyId) ?? null) : null,
    origin: row.ipHash ? row.ipHash.slice(0, 8) : null,
  }));
}
