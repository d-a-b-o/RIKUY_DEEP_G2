import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { createCredentialUser } from "@/lib/auth/users";

/**
 * Invitaciones por correo (HU23-T02, RIKDP-147; las reutiliza HU30).
 *
 * - El enlace lleva un token aleatorio de 32 bytes. En la base solo se guarda su
 *   SHA-256, así que una copia de la base no sirve para aceptar invitaciones.
 * - Una invitación vale INVITATION_DAYS días y se usa una sola vez. Al enviar
 *   otra al mismo correo de la misma empresa, las anteriores dejan de valer.
 * - Aceptarla crea la cuenta con el rol y la empresa de la invitación; quien la
 *   acepta solo elige su nombre y su contraseña.
 */

export const INVITATION_DAYS = 7;

type Db = PrismaClient | Prisma.TransactionClient;

export type InvitationErrorCode = "INVALID" | "EXPIRED" | "USED" | "COMPANY_INACTIVE" | "EMAIL_IN_USE";

export class InvitationError extends Error {
  constructor(
    readonly code: InvitationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type NewInvitation = {
  companyId: string;
  email: string;
  role: Role;
  invitedById: string;
  now?: Date;
};

/** Crea la invitación y devuelve el token en claro, que solo viaja en el correo. */
export async function createInvitation(db: Db, input: NewInvitation) {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();

  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new InvitationError("EMAIL_IN_USE", "Ya existe una cuenta con ese correo");
  }

  // Solo vale el último enlace enviado a ese correo.
  await db.invitation.updateMany({
    where: { companyId: input.companyId, email, acceptedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });

  const token = randomBytes(32).toString("base64url");
  const invitation = await db.invitation.create({
    data: {
      companyId: input.companyId,
      email,
      role: input.role,
      tokenHash: hashInvitationToken(token),
      invitedById: input.invitedById,
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return { invitation, token };
}

export type InvitationStatus = "valid" | "expired" | "used" | "invalid" | "company_inactive";

export type InvitationPreview = {
  status: InvitationStatus;
  email?: string;
  role?: Role;
  companyName?: string;
};

/** Datos que muestra la pantalla de aceptación, sin revelar nada si el token no existe. */
export async function previewInvitation(db: Db, token: string, now = new Date()): Promise<InvitationPreview> {
  if (!token) return { status: "invalid" };
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { email: true, role: true, acceptedAt: true, expiresAt: true, company: { select: { name: true, status: true } } },
  });
  if (!invitation) return { status: "invalid" };
  const base = { email: invitation.email, role: invitation.role, companyName: invitation.company.name };
  if (invitation.acceptedAt) return { ...base, status: "used" };
  if (invitation.expiresAt <= now) return { ...base, status: "expired" };
  if (invitation.company.status !== "ACTIVE") return { ...base, status: "company_inactive" };
  return { ...base, status: "valid" };
}

export type AcceptInvitation = { token: string; name: string; password: string; now?: Date };

/**
 * Acepta la invitación y crea la cuenta en una transacción. La invitación se
 * marca como usada con una sola sentencia condicional, así que dos envíos
 * simultáneos del mismo enlace no crean dos cuentas.
 */
export async function acceptInvitation(db: PrismaClient, input: AcceptInvitation) {
  const now = input.now ?? new Date();
  const tokenHash = hashInvitationToken(input.token);

  return db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { tokenHash, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      const preview = await previewInvitation(tx, input.token, now);
      if (preview.status === "used") throw new InvitationError("USED", "Esta invitación ya se usó");
      if (preview.status === "expired") throw new InvitationError("EXPIRED", "Esta invitación venció");
      throw new InvitationError("INVALID", "La invitación no es válida");
    }

    const invitation = await tx.invitation.findUniqueOrThrow({
      where: { tokenHash },
      select: { email: true, role: true, companyId: true, company: { select: { status: true } } },
    });
    if (invitation.company.status !== "ACTIVE") {
      throw new InvitationError("COMPANY_INACTIVE", "La empresa de esta invitación está desactivada");
    }
    if (await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } })) {
      throw new InvitationError("EMAIL_IN_USE", "Ya existe una cuenta con ese correo");
    }

    return createCredentialUser(
      {
        email: invitation.email,
        name: input.name,
        password: input.password,
        role: invitation.role,
        companyId: invitation.companyId,
      },
      tx,
    );
  });
}
