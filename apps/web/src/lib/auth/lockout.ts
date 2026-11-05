import "server-only";
import { getDb } from "@/lib/db";

/** Intentos fallidos seguidos que bloquean la cuenta (HU19, criterio 1). */
export const MAX_FAILED_ATTEMPTS = 5;
/** Minutos que dura el bloqueo temporal. */
export const LOCK_MINUTES = 15;

export type LockState = { locked: false } | { locked: true; until: Date };

/** Estado de bloqueo de una cuenta. Un correo que no existe nunca está bloqueado. */
export async function getLockState(email: string, now = new Date()): Promise<LockState> {
  const user = await getDb().user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { lockedUntil: true },
  });
  if (user?.lockedUntil && user.lockedUntil > now) return { locked: true, until: user.lockedUntil };
  return { locked: false };
}

/**
 * Registra un intento fallido en una sola sentencia, para que dos intentos
 * simultáneos no lean el mismo contador. Si un bloqueo anterior ya venció, la
 * cuenta vuelve a empezar desde 1. Al llegar a MAX_FAILED_ATTEMPTS se bloquea
 * durante LOCK_MINUTES.
 */
export async function registerFailedLogin(email: string): Promise<LockState> {
  const rows = await getDb().$queryRaw<{ locked_until: Date | null }[]>`
    UPDATE "user" AS u
    SET failed_login_count = next.count,
        locked_until = CASE
          WHEN next.count >= ${MAX_FAILED_ATTEMPTS}
            THEN now() + make_interval(mins => ${LOCK_MINUTES})
          WHEN next.expired THEN NULL
          ELSE u.locked_until
        END,
        updated_at = now()
    FROM (
      SELECT id,
             (locked_until IS NOT NULL AND locked_until <= now()) AS expired,
             CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                  ELSE failed_login_count + 1 END AS count
      FROM "user"
      WHERE email = ${normalizeEmail(email)}
      FOR UPDATE
    ) AS next
    WHERE u.id = next.id
    RETURNING u.locked_until`;

  const lockedUntil = rows[0]?.locked_until;
  if (lockedUntil && lockedUntil > new Date()) return { locked: true, until: lockedUntil };
  return { locked: false };
}

/** Pone a cero el contador tras un login correcto o un cambio de contraseña. */
export async function resetFailedLogins(where: { email: string } | { userId: string }): Promise<void> {
  await getDb().user.updateMany({
    where: "email" in where ? { email: normalizeEmail(where.email) } : { id: where.userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
