import "server-only";
import { Prisma, type CompanyStatus, type PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";
import { createInvitation, InvitationError } from "@/lib/invitations/service";
import type { AdminInviteInput, CompanyInput, NewCompanyInput } from "./schema";

/**
 * Gestión de empresas por el superadministrador (HU23, RIKDP-34).
 *
 * Cada operación exige `empresas:gestionar` en el servidor: la interfaz solo
 * oculta botones. Al desactivar una empresa se cierran las sesiones de todos sus
 * usuarios, y el login rechaza a sus cuentas (src/lib/auth/server.ts).
 */

export type CompanyErrorCode = "NOT_FOUND" | "DUPLICATE_TAX_ID" | "EMAIL_IN_USE" | "COMPANY_INACTIVE";

export class CompanyError extends Error {
  constructor(
    readonly code: CompanyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CompanyError";
  }
}

const PERMISSION = "empresas:gestionar" as const;

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  // Con el adaptador de Postgres el detalle puede venir en otro campo; basta con que lo mencione.
  return fields.some((f) => f.includes(field)) || error.message.includes(field);
}

function rethrowInvitation(error: unknown): never {
  if (error instanceof InvitationError && error.code === "EMAIL_IN_USE") {
    throw new CompanyError("EMAIL_IN_USE", "Ya existe una cuenta con ese correo");
  }
  throw error;
}

export type CompanySummary = {
  id: string;
  name: string;
  taxId: string | null;
  status: CompanyStatus;
  createdAt: Date;
  activeUsers: number;
  pendingInvitations: number;
};

export async function listCompanies(db: PrismaClient, actor: AuthzUser, now = new Date()): Promise<CompanySummary[]> {
  await authorize(actor, PERMISSION, { path: "listCompanies" });
  const companies = await db.company.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      taxId: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          users: { where: { active: true } },
          invitations: { where: { acceptedAt: null, expiresAt: { gt: now } } },
        },
      },
    },
  });
  return companies.map(({ _count, ...company }) => ({
    ...company,
    activeUsers: _count.users,
    pendingInvitations: _count.invitations,
  }));
}

export async function getCompany(db: PrismaClient, actor: AuthzUser, id: string) {
  await authorize(actor, PERMISSION, { empresaId: id, path: "getCompany" });
  const company = await db.company.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      taxId: true,
      timezone: true,
      status: true,
      createdAt: true,
      users: {
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, active: true },
      },
      invitations: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, acceptedAt: true },
      },
    },
  });
  if (!company) throw new CompanyError("NOT_FOUND", "La empresa no existe");
  return company;
}

/**
 * Crea la empresa e invita a su primer administrador en una transacción: si el
 * correo ya tiene cuenta, no queda una empresa a medias.
 */
export async function createCompany(db: PrismaClient, actor: AuthzUser, input: NewCompanyInput) {
  await authorize(actor, PERMISSION, { path: "createCompany" });
  try {
    return await db.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: input.name, taxId: input.taxId, timezone: input.timezone },
        select: { id: true, name: true },
      });
      const { invitation, token } = await createInvitation(tx, {
        companyId: company.id,
        email: input.adminEmail,
        role: "ADMIN",
        invitedById: actor.id,
      }).catch(rethrowInvitation);
      return { company, invitation, token };
    });
  } catch (error) {
    if (isUniqueViolation(error, "tax_id") || isUniqueViolation(error, "taxId")) {
      throw new CompanyError("DUPLICATE_TAX_ID", "Ya hay una empresa con ese RUC");
    }
    throw error;
  }
}

export async function updateCompany(db: PrismaClient, actor: AuthzUser, id: string, input: CompanyInput) {
  await authorize(actor, PERMISSION, { empresaId: id, path: "updateCompany" });
  try {
    return await db.company.update({
      where: { id },
      data: { name: input.name, taxId: input.taxId, timezone: input.timezone },
      select: { id: true, name: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new CompanyError("NOT_FOUND", "La empresa no existe");
    }
    if (isUniqueViolation(error, "tax_id") || isUniqueViolation(error, "taxId")) {
      throw new CompanyError("DUPLICATE_TAX_ID", "Ya hay una empresa con ese RUC");
    }
    throw error;
  }
}

/**
 * Activa o desactiva la empresa (HU23, criterio 3). Al desactivarla se borran
 * las sesiones de sus usuarios, para que nadie siga dentro hasta que caduquen.
 */
export async function setCompanyStatus(db: PrismaClient, actor: AuthzUser, id: string, status: CompanyStatus) {
  await authorize(actor, PERMISSION, { empresaId: id, path: "setCompanyStatus" });
  return db.$transaction(async (tx) => {
    const updated = await tx.company.updateMany({ where: { id }, data: { status } });
    if (updated.count !== 1) throw new CompanyError("NOT_FOUND", "La empresa no existe");
    const revoked =
      status === "INACTIVE" ? (await tx.session.deleteMany({ where: { user: { companyId: id } } })).count : 0;
    return { status, revokedSessions: revoked };
  });
}

/** Invita a otro administrador o reenvía la invitación a uno que no la aceptó. */
export async function inviteAdmin(db: PrismaClient, actor: AuthzUser, companyId: string, input: AdminInviteInput) {
  await authorize(actor, PERMISSION, { empresaId: companyId, path: "inviteAdmin" });
  return db.$transaction(async (tx) => {
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true } });
    if (!company) throw new CompanyError("NOT_FOUND", "La empresa no existe");
    if (company.status !== "ACTIVE") {
      throw new CompanyError("COMPANY_INACTIVE", "Activa la empresa antes de invitar a su administrador");
    }
    const { invitation, token } = await createInvitation(tx, {
      companyId,
      email: input.adminEmail,
      role: "ADMIN",
      invitedById: actor.id,
    }).catch(rethrowInvitation);
    return { company, invitation, token };
  });
}
