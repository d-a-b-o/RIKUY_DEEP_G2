import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";
import { createInvitation, InvitationError } from "@/lib/invitations/service";

/**
 * HU30 · Gestionar usuarios de mi planta (RIKDP-41).
 *
 * El Admin de planta invita, edita, desactiva y asigna rol de Inspector o
 * Visualizador. Todas las consultas filtran por la empresa del administrador
 * (HU30-T03): un id de otra empresa da NOT_FOUND, nunca sus datos. Los otros
 * administradores y las cuentas técnicas de estación se ven, pero no se tocan
 * desde aquí.
 */

export const PLANT_ROLES = ["INSPECTOR", "VIEWER"] as const;
export type PlantRole = (typeof PLANT_ROLES)[number];

export type UserErrorCode = "INVALID" | "NOT_FOUND" | "EMAIL_IN_USE" | "NOT_EDITABLE" | "SELF";

export class UserError extends Error {
  constructor(
    readonly code: UserErrorCode,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "UserError";
  }
}

const PERMISSION = "usuarios:gestionar" as const;

const roleSchema = z.enum(PLANT_ROLES, "Elige Inspector o Visualizador");

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre").max(100, "Máximo 100 caracteres"),
  email: z.email("Correo no válido").trim().toLowerCase().max(200),
  role: roleSchema,
});

export const updateSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre").max(100, "Máximo 100 caracteres"),
  role: roleSchema,
});

export const userFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  rol: z
    .string()
    .optional()
    .transform((v) => (v === "ADMIN" || v === "INSPECTOR" || v === "VIEWER" || v === "STATION" ? v : undefined)),
  estado: z
    .string()
    .optional()
    .transform((v) => (v === "activos" || v === "inactivos" ? v : undefined)),
});
export type UserFilters = z.output<typeof userFiltersSchema>;

function fieldsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

async function companyOf(actor: AuthzUser, action: string): Promise<string> {
  await authorize(actor, PERMISSION, { empresaId: actor.empresaId, path: action });
  if (!actor.empresaId) throw new UserError("NOT_FOUND", "Tu cuenta no pertenece a ninguna empresa");
  return actor.empresaId;
}

/** Usuario de la misma empresa que el admin puede modificar (Inspector o Visualizador, y no él mismo). */
async function editableTarget(db: PrismaClient | Prisma.TransactionClient, actor: AuthzUser, companyId: string, id: string) {
  if (id === actor.id) throw new UserError("SELF", "No puedes cambiar tu propia cuenta desde aquí");
  const user = await db.user.findFirst({ where: { id, companyId }, select: { id: true, role: true, email: true } });
  if (!user) throw new UserError("NOT_FOUND", "El usuario no existe en tu planta");
  if (!(PLANT_ROLES as readonly string[]).includes(user.role)) {
    throw new UserError("NOT_EDITABLE", "Solo se gestionan aquí las cuentas de Inspector y Visualizador");
  }
  return user;
}

// ─── Listado (HU30-T01) ─────────────────────────────────────────────────────

export async function listPlantUsers(db: PrismaClient, actor: AuthzUser, filters: UserFilters, now = new Date()) {
  const companyId = await companyOf(actor, "listPlantUsers");
  const where: Prisma.UserWhereInput = { companyId };
  if (filters.rol) where.role = filters.rol;
  if (filters.estado) where.active = filters.estado === "activos";
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const [users, invitations] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        _count: { select: { sessions: true } },
      },
    }),
    db.invitation.findMany({
      where: { companyId, acceptedAt: null, expiresAt: { gt: now }, role: { in: [...PLANT_ROLES] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);

  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      createdAt: u.createdAt,
      openSessions: u._count.sessions,
      editable: u.id !== actor.id && (PLANT_ROLES as readonly string[]).includes(u.role),
    })),
    invitations,
  };
}

export type PlantUsers = Awaited<ReturnType<typeof listPlantUsers>>;

// ─── Invitación (HU30-T02) ──────────────────────────────────────────────────

export async function invitePlantUser(db: PrismaClient, actor: AuthzUser, input: z.input<typeof inviteSchema>) {
  const companyId = await companyOf(actor, "invitePlantUser");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) throw new UserError("INVALID", "Revisa los campos marcados", fieldsOf(parsed.error));

  return db.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
    try {
      const { invitation, token } = await createInvitation(tx, {
        companyId,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedById: actor.id,
      });
      return { invitation, token, companyName: company.name, name: parsed.data.name };
    } catch (error) {
      if (error instanceof InvitationError && error.code === "EMAIL_IN_USE") {
        throw new UserError("EMAIL_IN_USE", "Ya existe una cuenta con ese correo", { email: "Ya existe una cuenta con ese correo" });
      }
      throw error;
    }
  });
}

/** Anula una invitación pendiente de la propia empresa. */
export async function revokeInvitation(db: PrismaClient, actor: AuthzUser, invitationId: string, now = new Date()) {
  const companyId = await companyOf(actor, "revokeInvitation");
  const updated = await db.invitation.updateMany({
    where: { id: invitationId, companyId, acceptedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  if (updated.count === 0) throw new UserError("NOT_FOUND", "La invitación no existe o ya no está pendiente");
}

// ─── Edición y desactivación (HU30-T01, criterio 4) ────────────────────────

export async function updatePlantUser(db: PrismaClient, actor: AuthzUser, id: string, input: z.input<typeof updateSchema>) {
  const companyId = await companyOf(actor, "updatePlantUser");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new UserError("INVALID", "Revisa los campos marcados", fieldsOf(parsed.error));

  return db.$transaction(async (tx) => {
    const target = await editableTarget(tx, actor, companyId, id);
    await tx.user.update({ where: { id: target.id }, data: parsed.data });
    // Al cambiar de rol se cierran sus sesiones: los permisos nuevos rigen desde el próximo ingreso.
    const revoked = target.role !== parsed.data.role ? (await tx.session.deleteMany({ where: { userId: target.id } })).count : 0;
    return { revokedSessions: revoked };
  });
}

/** Criterio 4: desactivar cierra todas sus sesiones abiertas. */
export async function setPlantUserActive(db: PrismaClient, actor: AuthzUser, id: string, active: boolean) {
  const companyId = await companyOf(actor, "setPlantUserActive");
  return db.$transaction(async (tx) => {
    const target = await editableTarget(tx, actor, companyId, id);
    await tx.user.update({ where: { id: target.id }, data: { active } });
    const revoked = active ? 0 : (await tx.session.deleteMany({ where: { userId: target.id } })).count;
    return { revokedSessions: revoked };
  });
}
