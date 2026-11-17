import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { authorize, can, type AuthzUser } from "@/lib/authz";
import { telemetryBatchSchema } from "./schema";

export async function storeTelemetry(db: PrismaClient, actor: AuthzUser, input: unknown) {
  if (!actor.empresaId || !(can(actor, "inspecciones:crear") || can(actor, "estacion:operar"))) {
    throw new Error("FORBIDDEN");
  }
  const { events } = telemetryBatchSchema.parse(input);
  const versions = [...new Set(events.flatMap(e => e.type === "INFERENCE" ? [e.version] : []))];
  const registered = versions.length ? await db.modelVersion.findMany({
    where: { version: { in: versions } }, select: { id: true, version: true },
  }) : [];
  const ids = new Map(registered.map(v => [v.version, v.id]));
  return db.modelTelemetry.createMany({ skipDuplicates: true, data: events.map(event => ({
    id: event.id, companyId: actor.empresaId!, type: event.type,
    modelVersionId: event.type === "INFERENCE" ? ids.get(event.version) ?? null : null,
    modelVersionLabel: event.type === "INFERENCE" ? event.version : null,
    durationMs: event.type === "INFERENCE" ? event.durationMs : null,
    backend: event.type === "INFERENCE" ? event.backend : null,
    // Never persist arbitrary browser errors: they can contain credentials or URLs.
    message: event.type === "LOAD_ERROR" ? event.stage : null,
  })) });
}

export type MetricRow = {
  type: "INFERENCE" | "LOAD_ERROR"; version: string | null; backend: string | null;
  stage: string | null; count: number; averageMs: number | null; p95Ms: number | null;
};
export async function loadMonitoring(db: PrismaClient, actor: AuthzUser, now = new Date()) {
  await authorize(actor, "monitoreo:ver", { path: "/panel/admin/monitoreo" });
  const since = new Date(now.getTime() - 86_400_000);
  const metrics = await db.$queryRaw<MetricRow[]>`
    SELECT type::text AS type, model_version_label AS version, backend::text AS backend,
      message AS stage, count(*)::int AS count,
      avg(duration_ms)::float8 AS "averageMs",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS "p95Ms"
    FROM model_telemetry WHERE created_at >= ${since} AND created_at <= ${now}
    GROUP BY type, model_version_label, backend, message
    ORDER BY type, model_version_label, backend, message
  `;
  return { since, until: now, metrics };
}
