import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * HU37, criterio 4 (y base para PT5 · RIKDP-205): el dashboard carga en menos
 * de 2 s con 500.000 inspecciones (una semana de 2 estaciones en 3 turnos).
 *
 * Inserta medio millón de filas, así que no corre por defecto:
 *   RIKUY_PERF=1 npx vitest run src/lib/dashboard/dashboard.perf.test.ts
 */
const ROWS = Number(process.env.RIKUY_PERF_ROWS ?? 500_000);

describe.skipIf(!process.env.DATABASE_URL || !process.env.RIKUY_PERF)(`dashboard con ${ROWS} inspecciones`, async () => {
  const { getDb } = await import("@/lib/db");
  const { setDeniedAccessLogger } = await import("@/lib/authz");
  const { getDashboard, parseDashboardFilters } = await import("./service");

  const db = getDb();
  const companyId = randomUUID();
  const version = `perf-${randomUUID()}`;
  const admin = { id: randomUUID(), role: "ADMIN" as const, empresaId: companyId };

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    await db.company.create({ data: { id: companyId, name: `Perf ${companyId}`, timezone: "America/Lima" } });
    const part = await db.part.create({ data: { companyId, code: "P", name: "Pieza" } });
    const molds = await Promise.all(
      Array.from({ length: 12 }, (_, i) => db.mold.create({ data: { companyId, partId: part.id, code: `M-${i}` } })),
    );
    const batch = await db.batch.create({ data: { companyId, moldId: molds[0]!.id, code: "L" } });
    const t = (h: string) => new Date(`1970-01-01T${h}:00.000Z`);
    const shifts = await Promise.all([
      db.shift.create({ data: { companyId, name: "Mañana", startTime: t("06:00"), endTime: t("14:00") } }),
      db.shift.create({ data: { companyId, name: "Tarde", startTime: t("14:00"), endTime: t("22:00") } }),
      db.shift.create({ data: { companyId, name: "Noche", startTime: t("22:00"), endTime: t("06:00") } }),
    ]);
    const stations = [];
    for (const name of ["E-1", "E-2"]) {
      const user = await db.user.create({
        data: { id: randomUUID(), companyId, role: "STATION", name, email: `${randomUUID()}@perf.test` },
      });
      stations.push(await db.station.create({ data: { companyId, userId: user.id, name, line: "L1" } }));
    }
    const mv = await db.modelVersion.create({ data: { version, artifactPath: "p", inputSize: 400, decisionThreshold: "0.2437" } });

    // Inserción masiva en SQL: 7 días hasta ahora, 2 estaciones, ~3 % defectuosas.
    await db.$executeRawUnsafe(`
      INSERT INTO inspection (id, company_id, batch_id, shift_id, mold_id, part_id, station_id, model_version_id, source,
        predicted_verdict, current_verdict, confidence, threshold_applied, image_key, captured_at, corrected_at)
      SELECT gen_random_uuid(), '${companyId}', '${batch.id}',
        (ARRAY['${shifts[0]!.id}','${shifts[1]!.id}','${shifts[2]!.id}']::text[])[1 + (n % 3)],
        (ARRAY[${molds.map((m) => `'${m.id}'`).join(",")}]::text[])[1 + (n % 12)],
        '${part.id}',
        (ARRAY['${stations[0]!.id}','${stations[1]!.id}']::text[])[1 + (n % 2)],
        '${mv.id}', 'LINE',
        CASE WHEN n % 33 = 0 THEN 'DEFECTIVE'::verdict ELSE 'OK'::verdict END,
        CASE WHEN n % 33 = 0 THEN 'DEFECTIVE'::verdict ELSE 'OK'::verdict END,
        0.9, 0.2437,
        CASE WHEN n % 33 = 0 THEN 'perf/' || n || '.jpg' END,
        now() - (n * (interval '7 days' / ${ROWS})),
        CASE WHEN n % 1000 = 0 THEN now() END
      FROM generate_series(1, ${ROWS}) AS n
    `);
    await db.$executeRawUnsafe(`ANALYZE inspection`);
  }, 600_000);

  afterAll(async () => {
    await db.$transaction([
      db.$executeRawUnsafe(`ALTER TABLE "inspection" DISABLE TRIGGER "inspection_immutable"`),
      db.inspection.deleteMany({ where: { companyId } }),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" ENABLE TRIGGER "inspection_immutable"`),
    ]);
    await db.station.deleteMany({ where: { companyId } });
    await db.batch.deleteMany({ where: { companyId } });
    await db.mold.deleteMany({ where: { companyId } });
    await db.part.deleteMany({ where: { companyId } });
    await db.shift.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId } });
    await db.company.delete({ where: { id: companyId } });
    await db.modelVersion.deleteMany({ where: { version } });
  }, 600_000);

  it("los últimos 7 días cargan en menos de 2 s", async () => {
    await getDashboard(db, admin, parseDashboardFilters({})); // calienta conexión y caché
    const started = performance.now();
    const dashboard = await getDashboard(db, admin, parseDashboardFilters({}));
    const elapsed = performance.now() - started;
    console.info(`[perf] ${dashboard.kpis.inspected} inspecciones en ${Math.round(elapsed)} ms`);
    expect(dashboard.kpis.inspected).toBeGreaterThan(ROWS * 0.95);
    expect(dashboard.byStation).toHaveLength(2);
    expect(dashboard.byShift).toHaveLength(3);
    expect(elapsed).toBeLessThan(2000);
  }, 60_000);

  it("con filtros también", async () => {
    const shift = await db.shift.findFirstOrThrow({ where: { companyId, name: "Noche" } });
    const started = performance.now();
    const dashboard = await getDashboard(db, admin, parseDashboardFilters({ turno: shift.id }));
    const elapsed = performance.now() - started;
    console.info(`[perf] filtro por turno: ${dashboard.kpis.inspected} en ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(2000);
  }, 60_000);
});
