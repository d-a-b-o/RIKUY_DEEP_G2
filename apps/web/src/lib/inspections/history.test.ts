import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, decodeCursor, encodeCursor, parseHistoryFilters, startOfLocalDay } from "./history";

/** HU42 · Historial de inspecciones (RIKDP-53, RIKDP-219). */

describe("filtros del historial", () => {
  it("acepta los filtros válidos de la URL e ignora los inválidos", () => {
    const id = randomUUID();
    expect(
      parseHistoryFilters({
        desde: "2026-11-01",
        hasta: "no-es-fecha",
        veredicto: "DEFECTIVE",
        origen: "TELEPATIA",
        lote: id,
        molde: "' OR 1=1 --",
        corregidas: "1",
        reentrenamiento: ["true", "false"],
      }),
    ).toMatchObject({
      desde: "2026-11-01",
      hasta: undefined,
      veredicto: "DEFECTIVE",
      origen: undefined,
      lote: id,
      molde: undefined,
      corregidas: true,
      reentrenamiento: true,
    });
  });

  it("sin parámetros no filtra nada", () => {
    const none = parseHistoryFilters({});
    expect(none).toMatchObject({ corregidas: false, reentrenamiento: false });
    expect(none.veredicto ?? none.lote ?? none.desde ?? none.cursor).toBeUndefined();
  });
});

describe("cursor", () => {
  it("ida y vuelta", () => {
    const cursor = { capturedAt: new Date("2026-11-05T13:45:00.123Z"), id: randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("un cursor manipulado se ignora", () => {
    expect(decodeCursor("basura")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-01-01|no-uuid").toString("base64url"))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe("días en la zona horaria de la planta", () => {
  it("la medianoche de Lima es a las 05:00 UTC", () => {
    expect(startOfLocalDay("2026-11-05", "America/Lima").toISOString()).toBe("2026-11-05T05:00:00.000Z");
  });

  it("respeta el horario de verano de otras zonas", () => {
    expect(startOfLocalDay("2026-07-01", "America/Santiago").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfLocalDay("2026-01-15", "America/Santiago").toISOString()).toBe("2026-01-15T03:00:00.000Z");
  });

  it("addDays cruza meses y años", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("historial contra Postgres (HU42)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError, setDeniedAccessLogger } = await import("@/lib/authz");
  const { getHistoryFilterOptions, listInspections } = await import("./history");
  type AuthzUser = import("@/lib/authz").AuthzUser;

  const db = getDb();
  const companies: string[] = [];
  const modelVersion = `0.0.0-hu42-${randomUUID()}`;
  let ctx: {
    viewer: AuthzUser;
    station: AuthzUser;
    outsider: AuthzUser;
    batchA: string;
    batchB: string;
    night: string;
    ids: string[];
  };

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    const mv = await db.modelVersion.create({
      data: { version: modelVersion, artifactPath: "t/model.json", inputSize: 400, decisionThreshold: "0.2437" },
    });

    async function plant(name: string) {
      const company = await db.company.create({ data: { name: `${name} ${randomUUID()}`, timezone: "America/Lima" } });
      companies.push(company.id);
      const part = await db.part.create({ data: { companyId: company.id, code: "P-1", name: "Impulsor" } });
      const mold = await db.mold.create({ data: { companyId: company.id, partId: part.id, code: "M-1" } });
      const batchA = await db.batch.create({ data: { companyId: company.id, moldId: mold.id, code: "L-A" } });
      const batchB = await db.batch.create({ data: { companyId: company.id, moldId: mold.id, code: "L-B" } });
      const day = await db.shift.create({
        data: { companyId: company.id, name: "Día", startTime: new Date("1970-01-01T06:00:00Z"), endTime: new Date("1970-01-01T18:00:00Z") },
      });
      const night = await db.shift.create({
        data: { companyId: company.id, name: "Noche", startTime: new Date("1970-01-01T18:00:00Z"), endTime: new Date("1970-01-01T06:00:00Z") },
      });
      const inspector = await db.user.create({
        data: { id: randomUUID(), companyId: company.id, role: "INSPECTOR", name: "Insp", email: `${randomUUID()}@hu42.test` },
      });
      return { company, part, mold, batchA, batchB, day, night, inspector };
    }

    const a = await plant("HU42 A");
    const b = await plant("HU42 B");

    // 30 inspecciones en A: una cada hora desde el 2026-11-03 00:00 de Lima (05:00 UTC).
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const capturedAt = new Date(Date.UTC(2026, 10, 3, 5 + i));
      const defective = i % 3 === 0;
      const inspection = await db.inspection.create({
        data: {
          companyId: a.company.id,
          batchId: i < 15 ? a.batchA.id : a.batchB.id,
          shiftId: i % 2 === 0 ? a.day.id : a.night.id,
          moldId: a.mold.id,
          partId: a.part.id,
          inspectorId: a.inspector.id,
          modelVersionId: mv.id,
          source: "CAMERA",
          predictedVerdict: defective ? "DEFECTIVE" : "OK",
          currentVerdict: defective ? "DEFECTIVE" : "OK",
          confidence: "0.9000",
          thresholdApplied: "0.2437",
          // Las manuales y las defectuosas siempre llevan foto (regla 9).
          imageKey: `${a.company.id}/test/${randomUUID()}.jpg`,
          capturedAt,
        },
      });
      ids.push(inspection.id);
    }
    // La n.º 1 (OK) se corrigió a DEFECTIVE y quedó marcada para reentrenamiento.
    await db.inspection.update({ where: { id: ids[1] }, data: { currentVerdict: "DEFECTIVE", correctedAt: new Date() } });
    await db.inspectionEvent.createMany({
      data: [
        { companyId: a.company.id, inspectionId: ids[1], type: "CORRECTED", previousVerdict: "OK", newVerdict: "DEFECTIVE", reason: "poro" },
        { companyId: a.company.id, inspectionId: ids[1], type: "FLAGGED_FOR_RETRAINING", reason: "poro" },
      ],
    });
    // Una inspección en B que A nunca debe ver.
    await db.inspection.create({
      data: {
        companyId: b.company.id,
        batchId: b.batchA.id,
        shiftId: b.day.id,
        moldId: b.mold.id,
        partId: b.part.id,
        inspectorId: b.inspector.id,
        modelVersionId: mv.id,
        source: "CAMERA",
        predictedVerdict: "OK",
        currentVerdict: "OK",
        confidence: "0.9",
        thresholdApplied: "0.2437",
        imageKey: `${b.company.id}/test/${randomUUID()}.jpg`,
        capturedAt: new Date(Date.UTC(2026, 10, 3, 12)),
      },
    });

    ctx = {
      viewer: { id: randomUUID(), role: "VIEWER", empresaId: a.company.id },
      station: { id: randomUUID(), role: "STATION", empresaId: a.company.id },
      outsider: { id: randomUUID(), role: "VIEWER", empresaId: b.company.id },
      batchA: a.batchA.id,
      batchB: a.batchB.id,
      night: a.night.id,
      ids,
    };
  });

  afterAll(async () => {
    // Inspecciones inmutables (ADR 0004): se limpian como en service.test.ts (HU24).
    await db.$transaction([
      db.$executeRawUnsafe(`ALTER TABLE "inspection_event" DISABLE TRIGGER "inspection_event_append_only"`),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" DISABLE TRIGGER "inspection_immutable"`),
      db.inspectionEvent.deleteMany({ where: { companyId: { in: companies } } }),
      db.inspection.deleteMany({ where: { companyId: { in: companies } } }),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" ENABLE TRIGGER "inspection_immutable"`),
      db.$executeRawUnsafe(`ALTER TABLE "inspection_event" ENABLE TRIGGER "inspection_event_append_only"`),
    ]);
    await db.batch.deleteMany({ where: { companyId: { in: companies } } });
    await db.shift.deleteMany({ where: { companyId: { in: companies } } });
    await db.mold.deleteMany({ where: { companyId: { in: companies } } });
    await db.part.deleteMany({ where: { companyId: { in: companies } } });
    await db.user.deleteMany({ where: { companyId: { in: companies } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.modelVersion.deleteMany({ where: { version: modelVersion } });
    setDeniedAccessLogger(() => {});
  });

  const all = parseHistoryFilters({});

  it("pagina de la más reciente a la más antigua sin repetir ni saltar ninguna", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listInspections(db, ctx.viewer, { ...all, cursor }, 7);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([...ctx.ids].reverse());
  });

  it("aísla por empresa: B no ve las inspecciones de A", async () => {
    const page = await listInspections(db, ctx.outsider, all, 100);
    expect(page.rows).toHaveLength(1);
    expect(page.rows.some((r) => ctx.ids.includes(r.id))).toBe(false);
  });

  it("combina filtros: defectuosas del lote B en el turno noche", async () => {
    const page = await listInspections(
      db,
      ctx.viewer,
      parseHistoryFilters({ veredicto: "DEFECTIVE", lote: ctx.batchB, turno: ctx.night }),
      100,
    );
    // Lote B = n.º 15–29; noche = impares; defectuosas = múltiplos de 3 → 15, 21, 27.
    expect(page.rows.map((r) => r.id).sort()).toEqual([ctx.ids[15], ctx.ids[21], ctx.ids[27]].sort());
  });

  it("filtra por día en la hora de la planta, no en UTC", async () => {
    // El 3 de noviembre en Lima son las primeras 24 inspecciones (n.º 0–23).
    const page = await listInspections(db, ctx.viewer, parseHistoryFilters({ desde: "2026-11-03", hasta: "2026-11-03" }), 100);
    expect(page.rows).toHaveLength(24);
  });

  it("solo corregidas y solo marcadas para reentrenamiento", async () => {
    const corrected = await listInspections(db, ctx.viewer, parseHistoryFilters({ corregidas: "1" }), 100);
    expect(corrected.rows.map((r) => r.id)).toEqual([ctx.ids[1]]);
    expect(corrected.rows[0]).toMatchObject({ corrected: true, predictedVerdict: "OK", currentVerdict: "DEFECTIVE" });
    const flagged = await listInspections(db, ctx.viewer, parseHistoryFilters({ reentrenamiento: "1" }), 100);
    expect(flagged.rows.map((r) => r.id)).toEqual([ctx.ids[1]]);
  });

  it("una estación no consulta el historial", async () => {
    await expect(listInspections(db, ctx.station, all)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("las opciones de filtro son solo de la propia empresa", async () => {
    const options = await getHistoryFilterOptions(db, ctx.viewer);
    expect(options.batches.map((b) => b.label).sort()).toEqual(["L-A", "L-B"]);
    expect(options.shifts.map((s) => s.label)).toEqual(["Día", "Noche"]);
  });
});
