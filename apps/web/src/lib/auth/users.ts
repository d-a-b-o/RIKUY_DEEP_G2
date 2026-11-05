import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PrismaClient, Role } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export type NewCredentialUser = {
  email: string;
  name: string;
  password: string;
  role: Role;
  companyId: string | null;
};

/**
 * Crea un usuario con contraseña, con el mismo formato que usa Better Auth:
 * la fila de `user` y una cuenta `credential` con el hash scrypt.
 *
 * El registro público está desactivado; lo usan el seed, las pruebas y, más
 * adelante, la aceptación de invitaciones (HU23, HU30).
 */
export async function createCredentialUser(input: NewCredentialUser, db: PrismaClient = getDb()) {
  const userId = randomUUID();
  const password = await hashPassword(input.password);
  return db.user.create({
    data: {
      id: userId,
      email: input.email.trim().toLowerCase(),
      name: input.name,
      role: input.role,
      companyId: input.companyId,
      emailVerified: true,
      accounts: {
        create: { id: randomUUID(), accountId: userId, providerId: "credential", password },
      },
    },
  });
}
