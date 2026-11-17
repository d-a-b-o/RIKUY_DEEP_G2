import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { getSession } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { loadActor } from "@/lib/inspections/service";
import { can } from "@/lib/authz";
import { applicationOrigins, isSameOriginMutation } from "@/lib/security/policy";
import { consumeWriteLimit } from "@/lib/security/write-limit";
import { storeTelemetry } from "@/lib/monitoring/service";

export async function POST(request: Request) {
  const reply = (data: object, status: number) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
  if (!isSameOriginMutation(request.headers, applicationOrigins())) return reply({ error: "FORBIDDEN" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "INVALID" }, 400);
  try {
    const session = await getSession();
    if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
    const db = getDb();
    const actor = await loadActor(db, session.user.id);
    if (!actor || (actor.role === "STATION" && !actor.stationId)) return reply({ error: "FORBIDDEN" }, 403);
    const user = { id: actor.userId, role: actor.role, empresaId: actor.companyId };
    if (!user.empresaId || !(can(user, "inspecciones:crear") || can(user, "estacion:operar"))) return reply({ error: "FORBIDDEN" }, 403);
    const quota = await consumeWriteLimit("hu43-user:" + createHash("sha256").update(user.id).digest("hex"),
      { bucket: "telemetry-user", max: 12, windowMs: 60_000 });
    if (!quota.allowed) return reply({ error: "TOO_MANY_REQUESTS" }, 429);
    // Bound bytes while reading; Content-Length can be absent or forged.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "INVALID" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); return reply({ error: "TOO_LARGE" }, 413); }
      chunks.push(value);
    }
    const result = await storeTelemetry(db, user, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return reply({ accepted: result.count }, 202);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return reply({ error: "INVALID" }, 400);
    return reply({ error: "UNAVAILABLE" }, 503);
  }
}
