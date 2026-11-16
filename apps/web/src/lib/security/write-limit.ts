import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getDb } from "@/lib/db";

export type WritePolicy = { bucket: string; max: number; windowMs: number };

export function writePolicy(path: string): WritePolicy {
  if (path === "/panel" || path.startsWith("/panel/")) return { bucket: "panel", max: 240, windowMs: 60_000 };
  if (path === "/invitacion") return { bucket: "invitation", max: 10, windowMs: 600_000 };
  return { bucket: "public", max: 5, windowMs: 600_000 };
}

export function writeLimitKey(headers: Headers, policy: WritePolicy): string {
  // Vercel overwrites XFF. Other deployments must also overwrite it at trusted ingress.
  const raw = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = raw && isIP(raw) ? raw : "unknown";
  return "hu48-write:" + createHash("sha256").update(`${policy.bucket}:${ip}`).digest("hex");
}

/** Atomic, shared across serverless instances; uses the existing Better Auth rate_limit table. */
export async function consumeWriteLimit(key: string, policy: WritePolicy): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now();
  // Each speculative INSERT needs a distinct primary key. The shared quota is
  // identified only by key, the unique index targeted by ON CONFLICT below.
  const rows = await getDb().$queryRaw<{ count: number; last_request: bigint }[]>`
    INSERT INTO rate_limit (id, key, count, last_request)
    VALUES (${randomUUID()}, ${key}, 1, ${BigInt(now)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit.last_request <= ${BigInt(now - policy.windowMs)}
        THEN 1 ELSE LEAST(rate_limit.count + 1, ${policy.max + 1}) END,
      last_request = CASE WHEN rate_limit.last_request <= ${BigInt(now - policy.windowMs)}
        THEN ${BigInt(now)} ELSE rate_limit.last_request END
    RETURNING count, last_request
  `;
  const row = rows[0];
  if (!row) throw new Error("El limitador no devolvió un resultado");
  return { allowed: row.count <= policy.max,
    retryAfter: Math.max(1, Math.ceil((Number(row.last_request) + policy.windowMs - now) / 1000)) };
}
