import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDashboardFilters, resolveRange } from "./service";

/** HU37 · Dashboard de calidad (RIKDP-48, RIKDP-201, RIKDP-202, RIKDP-203). */

describe("rango de fechas", () => {
  it("por defecto son los últimos 7 días hasta hoy", () => {
    expect(resolveRange(parseDashboardFilters({}), "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08", clipped: false });
  });

  it("ordena un rango invertido y recorta a 92 días", () => {
    expect(resolveRange(parseDashboardFilters({ desde: "2026-11-08", hasta: "2026-11-01" }), "2026-11-08")).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-08",
    });
    expect(resolveRange(parseDashboardFilters({ desde: "2025-01-01", hasta: "2026-11-08" }), "2026-11-08")).toEqual({
      from: "2026-08-09",
      to: "2026-11-08",
      clipped: true,
    });
  });

  it("ignora filtros inválidos", () => {
    expect(parseDashboardFilters({ turno: "1; DROP TABLE", desde: "ayer" })).toMatchObject({ turno: undefined, desde: undefined });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("dashboard contra Postgres (HU37)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError, setDeniedAccessLogger } = await import("@/lib/authz");
  const { getDashboard } = await import("./service");
  const { buildShiftReport } = await import("@/lib/reports/shift-report");
  type AuthzUser = import("@/lib/authz").AuthzUser;

  const db = getDb();
  const companies: string[] = [];
  const modelVersion = `0.0.0-hu37-${randomUUID()}`;
  const now = new Date("2026-11-08T20:00:00Z"); // 15:00 en Lima
  let ctx: { viewer: AuthzUser; station: AuthzUser; outsider: AuthzUser; night: string; e1: string; m12: string; m13: string };

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    const company = await db.company.create({ data: { name: `HU37 ${randomUUID()}`, timezone: "America/Lima" } });
    const other = await db.company.create({ data: { name: `HU37 otra ${randomUUID()}`, timezone: "America/Lima" } });
    companies.push(company.id, other.id);
    const companyId = company.id;
    const part = await db.part.create({ data: { companyId, code: "IMP", name: "Impulsor" } });
    const m12 = await db.mold.create({ data: { companyId, partId: part.id, code: "M-12" } });
    const m13 = await db.mold.create({ data: { companyId, partId: part.id, code: "M-13" } });
    const batch = await db.batch.create({ data: { companyId, moldId: m12.id, code: "L-1" } });
    const t = (h: string) => new Date(`1970-01-01T${h}:00.000Z`);
    const day = await db.shift.create({ data: { companyId, name: "Día", startTime: t("06:00"), endTime: t("22:00") } });
    const night = await db.shift.create({ data: { companyId, name: "Noche", startTime: t("22:00"), endTime: t("06:00") } });
    const stUser = await db.user.create({ data: { id: randomUUID(), companyId, role: "STATION", name: "E-1", email: `${randomUUID()}@hu37.test` } });
    const e1 = await db.station.create({ data: { companyId, userId: stUser.id, name: "E-1", line: "L1" } });
    const insp = await db.user.create({ data: { id: randomUUID(), companyId, role: "INSPECTOR", name: "Ana", email: `${randomUUID()}@hu37.test` } });
    const mv = await db.modelVersion.create({ data: { version: modelVersion, artifactPath: "t", inputSize: 400, decisionThreshold: "0.2437" } });

    const base = { companyId, batchId: batch.id, partId: part.id, modelVersionId: mv.id, confidence: "0.9", thresholdApplied: "0.2437" };
    const at = (iso: string) => new Date(iso);
    const make = async (o: { when: string; shift: string; mold: string; defective?: boolean; station?: boolean; corrected?: boolean }) => {
      const verdict = o.defective ? ("DEFECTIVE" as const) : ("OK" as const);
      await db.inspection.create({
        data: {
          ...base,
          shiftId: o.shift,
          moldId: o.mold,
          ...(o.station ? { stationId: e1.id, source: "LINE" as const } : { inspectorId: insp.id, source: "CAMERA" as const }),
          predictedVerdict: o.corrected ? (o.defective ? "OK" : "DEFECTIVE") : verdict,
          currentVerdict: verdict,
          correctedAt: o.corrected ? now : null,
          imageKey: o.defective || o.corrected || !o.station ? `${companyId}/${randomUUID()}.jpg` : null,
          capturedAt: at(o.when),
        },
      });
    };
    // 7/11 (Lima): 3 de día en M-12 (1 defectuosa), 1 manual en M-13 defectuosa.
    await make({ when: "2026-11-07T15:00:00Z", shift: day.id, mold: m12.id, station: true });
    await make({ when: "2026-11-07T16:00:00Z", shift: day.id, mold: m12.id, station: true });
    await make({ when: "2026-11-07T17:00:00Z", shift: day.id, mold: m12.id, station: true, defective: true });
    await make({ when: "2026-11-07T18:00:00Z", shift: day.id, mold: m13.id, defective: true, corrected: true });
    // Noche del 7 al 8: 23:30 del 7 y 02:00 del 8 en Lima → días distintos en la tendencia.
    await make({ when: "2026-11-08T04:30:00Z", shift: night.id, mold: m13.id, station: true, defective: true });
    await make({ when: "2026-11-08T07:00:00Z", shift: night.id, mold: m13.id, station: true });
    // Fuera del rango por defecto (hace 10 días).
    await make({ when: "2026-10-29T15:00:00Z", shift: day.id, mold: m12.id, station: true, defective: true });

    ctx = {
      viewer: { id: randomUUID(), role: "VIEWER", empresaId: companyId },
      station: { id: randomUUID(), role: "STATION", empresaId: companyId },
      outsider: { id: randomUUID(), role: "ADMIN", empresaId: other.id },
      night: night.id,
      e1: e1.id,
      m12: m12.id,
      m13: m13.id,
    };
  });

  afterAll(async () => {
    await db.$transaction([
      db.$executeRawUnsafe(`ALTER TABLE "inspection" DISABLE TRIGGER "inspection_immutable"`),
      db.inspection.deleteMany({ where: { companyId: { in: companies } } }),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" ENABLE TRIGGER "inspection_immutable"`),
    ]);
    await db.station.deleteMany({ where: { companyId: { in: companies } } });
    await db.batch.deleteMany({ where: { companyId: { in: companies } } });
    await db.mold.deleteMany({ where: { companyId: { in: companies } } });
    await db.part.deleteMany({ where: { companyId: { in: companies } } });
    await db.shift.deleteMany({ where: { companyId: { in: companies } } });
    await db.user.deleteMany({ where: { companyId: { in: companies } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.modelVersion.deleteMany({ where: { version: modelVersion } });
  });

  it("KPI del período, por turno y por estación (criterio 1)", async () => {
    const d = await getDashboard(db, ctx.viewer, parseDashboardFilters({}), now);
    expect(d.range).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(d.kpis).toEqual({ inspected: 6, ok: 3, defective: 3, defectRate: 0.5, corrected: 1 });
    expect(d.byShift.map((s) => [s.label, s.inspected, s.defective])).toEqual([
      ["Día", 4, 2],
      ["Noche", 2, 1],
    ]);
    expect(d.byStation.map((s) => [s.label, s.inspected, s.defective, s.corrected])).toEqual([
      ["E-1", 5, 2, 0],
      ["Inspección manual", 1, 1, 1],
    ]);
  });

  it("tendencia por día en hora de Lima, con los días vacíos en cero (criterio 2)", async () => {
    const d = await getDashboard(db, ctx.viewer, parseDashboardFilters({}), now);
    expect(d.trend).toHaveLength(7);
    expect(d.trend.find((p) => p.day === "2026-11-07")).toMatchObject({ inspected: 5, defective: 3 });
    expect(d.trend.find((p) => p.day === "2026-11-08")).toMatchObject({ inspected: 1, defective: 0 });
    expect(d.trend.find((p) => p.day === "2026-11-03")).toMatchObject({ inspected: 0 });
  });

  it("ranking de moldes con más defectuosas", async () => {
    const d = await getDashboard(db, ctx.viewer, parseDashboardFilters({}), now);
    expect(d.moldRanking.map((m) => [m.label, m.defective, m.inspected])).toEqual([
      ["M-13 · IMP", 2, 3],
      ["M-12 · IMP", 1, 3],
    ]);
  });

  it("filtros combinables: estación + molde + rango", async () => {
    const d = await getDashboard(
      db,
      ctx.viewer,
      parseDashboardFilters({ estacion: ctx.e1, molde: ctx.m12, desde: "2026-10-25", hasta: "2026-11-08" }),
      now,
    );
    expect(d.kpis).toMatchObject({ inspected: 4, defective: 2 });
  });

  it("coincide con el reporte de fin de turno (criterio 3)", async () => {
    const admin: AuthzUser = { id: randomUUID(), role: "ADMIN", empresaId: ctx.viewer.empresaId };
    const report = await buildShiftReport(db, admin, { fecha: "2026-11-07", turno: ctx.night });
    const d = await getDashboard(db, ctx.viewer, parseDashboardFilters({ turno: ctx.night }), now);
    expect(d.kpis).toEqual(report.kpis);
  });

  it("aísla por empresa y no se abre a la estación", async () => {
    const d = await getDashboard(db, ctx.outsider, parseDashboardFilters({}), now);
    expect(d.kpis.inspected).toBe(0);
    await expect(getDashboard(db, ctx.station, parseDashboardFilters({}), now)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
