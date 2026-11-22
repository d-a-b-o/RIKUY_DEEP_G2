import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * PT5 · RIKDP-265 — Acceso a recursos de otra empresa (IDOR).
 *
 * Dos empresas, A y B. Con cuentas de B se intenta leer y modificar cada recurso
 * de A que una pantalla o una Server Action recibe por id desde el navegador.
 * Ninguna operación debe devolver datos de A ni cambiarlos: el servicio responde
 * NOT_FOUND (no revela que el id existe) o FORBIDDEN, y la fila de A queda igual.
 *
 * Complementa las pruebas de cada módulo con una sola lista que recorre todos los
 * puntos de entrada. Si se agrega una pantalla o acción que recibe ids, se agrega aquí.
 */
describe.skipIf(!process.env.DATABASE_URL)("aislamiento entre empresas (IDOR, RIKDP-265)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError } = await import("@/lib/authz");
  const { buildImageKey } = await import("@/lib/storage/r2");
  const inspections = await import("@/lib/inspections/service");
  const history = await import("@/lib/inspections/history");
  const catalogs = await import("@/lib/catalogs/service");
  const users = await import("@/lib/users/service");
  const dashboard = await import("@/lib/dashboard/service");
  const reports = await import("@/lib/reports/shift-report");
  const companies = await import("@/lib/companies/service");
  const stations = await import("@/lib/station/service");
  type Actor = import("@/lib/inspections/service").Actor;
  type Role = "ADMIN" | "INSPECTOR" | "VIEWER" | "STATION";

  const db = getDb();
  const companyIds: string[] = [];
  const modelVersion = `0.0.0-idor-${randomUUID()}`;
  const deps = { db, imageExists: async () => true, storageConfigured: () => true };

  type Plant = {
    company: string;
    part: string;
    mold: string;
    batch: string;
    shift: string;
    inspection: string;
    imageKey: string;
    inspector: { id: string; role: Role; empresaId: string };
    admin: { id: string; role: Role; empresaId: string };
    viewer: { id: string; role: Role; empresaId: string };
    invitation: string;
    station: string;
    stationUser: string;
  };
  let a: Plant;
  let b: Plant;

  async function newUser(companyId: string, role: Role) {
    const user = await db.user.create({
      data: { id: randomUUID(), companyId, role, name: `${role} IDOR`, email: `${randomUUID()}@idor.test` },
    });
    return { id: user.id, role, empresaId: companyId };
  }

  async function actorOf(userId: string): Promise<Actor> {
    const actor = await inspections.loadActor(db, userId);
    if (!actor) throw new Error("actor no encontrado");
    return actor;
  }

  async function newPlant(label: string): Promise<Plant> {
    const company = await db.company.create({ data: { name: `IDOR ${label} ${randomUUID()}`, timezone: "America/Lima" } });
    companyIds.push(company.id);
    const part = await db.part.create({ data: { companyId: company.id, code: `P-${label}`, name: `Pieza ${label}` } });
    const mold = await db.mold.create({ data: { companyId: company.id, partId: part.id, code: `M-${label}` } });
    const batch = await db.batch.create({ data: { companyId: company.id, moldId: mold.id, code: `L-${label}` } });
    const shift = await db.shift.create({
      data: {
        companyId: company.id,
        name: `Todo el día ${label}`,
        startTime: new Date("1970-01-01T00:00:00Z"),
        endTime: new Date("1970-01-01T23:59:00Z"),
      },
    });
    const inspector = await newUser(company.id, "INSPECTOR");
    const admin = await newUser(company.id, "ADMIN");
    const viewer = await newUser(company.id, "VIEWER");
    const imageKey = buildImageKey(company.id);
    const { id: inspection } = await inspections.recordInspection(deps, await actorOf(inspector.id), {
      batchId: batch.id,
      shiftId: shift.id,
      source: "CAMERA",
      modelVersion,
      predictedVerdict: "DEFECTIVE",
      confidence: 0.91,
      thresholdApplied: 0.2437,
      imageKey,
      capturedAt: new Date(),
    });
    const invitation = await db.invitation.create({
      data: {
        companyId: company.id,
        email: `${randomUUID()}@idor.test`,
        role: "INSPECTOR",
        tokenHash: randomUUID().replace(/-/g, "").padEnd(64, "0"),
        invitedById: admin.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const { id: station } = await stations.createStation(
      db,
      admin,
      { name: `E-${label}`, line: "Línea", email: `${randomUUID()}@idor.test`, password: "una-clave-larga" },
      { min: 10, max: 128 },
    );
    const stationRow = await db.station.findUniqueOrThrow({ where: { id: station } });
    return {
      company: company.id,
      part: part.id,
      mold: mold.id,
      batch: batch.id,
      shift: shift.id,
      inspection,
      imageKey,
      inspector,
      admin,
      viewer,
      invitation: invitation.id,
      station,
      stationUser: stationRow.userId!,
    };
  }

  /** La operación falla sin revelar datos: NOT_FOUND (preferido) o FORBIDDEN. */
  async function expectDenied(work: Promise<unknown>) {
    const outcome = await work.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    expect(outcome.ok, "la operación con un id de otra empresa no debe completarse").toBe(false);
    if (outcome.ok) return;
    const error = outcome.error as { code?: string };
    const denied = outcome.error instanceof ForbiddenError || error.code === "NOT_FOUND" || error.code === "FORBIDDEN";
    expect(denied, `error inesperado: ${String(outcome.error)}`).toBe(true);
  }

  beforeAll(async () => {
    await db.modelVersion.create({
      data: { version: modelVersion, artifactPath: "test/model.json", inputSize: 400, decisionThreshold: "0.2437" },
    });
    a = await newPlant("A");
    b = await newPlant("B");
  });

  afterAll(async () => {
    await db.$transaction([
      db.$executeRawUnsafe(`ALTER TABLE "inspection_event" DISABLE TRIGGER "inspection_event_append_only"`),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" DISABLE TRIGGER "inspection_immutable"`),
      db.inspectionEvent.deleteMany({ where: { companyId: { in: companyIds } } }),
      db.inspection.deleteMany({ where: { companyId: { in: companyIds } } }),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" ENABLE TRIGGER "inspection_immutable"`),
      db.$executeRawUnsafe(`ALTER TABLE "inspection_event" ENABLE TRIGGER "inspection_event_append_only"`),
    ]);
    await db.station.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.invitation.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.batch.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.mold.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.part.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.shift.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.user.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.company.deleteMany({ where: { id: { in: companyIds } } });
    await db.modelVersion.deleteMany({ where: { version: modelVersion } });
  });

  describe("inspecciones e historial (HU24, HU40, HU42)", () => {
    it("el detalle de una inspección de otra empresa no existe", async () => {
      for (const user of [b.inspector, b.admin, b.viewer]) {
        await expectDenied(inspections.getInspectionTrace(deps, await actorOf(user.id), a.inspection));
      }
    });

    it("no se puede corregir el veredicto de otra empresa y la inspección no cambia", async () => {
      for (const user of [b.inspector, b.admin]) {
        await expectDenied(
          inspections.correctVerdict(deps, await actorOf(user.id), {
            inspectionId: a.inspection,
            newVerdict: "OK",
            reason: "Intento desde otra empresa",
          }),
        );
      }
      const row = await db.inspection.findUniqueOrThrow({ where: { id: a.inspection } });
      expect(row.currentVerdict).toBe("DEFECTIVE");
      expect(await db.inspectionEvent.count({ where: { inspectionId: a.inspection, type: "CORRECTED" } })).toBe(0);
    });

    it("no se registra una inspección en un lote o turno de otra empresa, ni con una foto de otra empresa", async () => {
      const actor = await actorOf(b.inspector.id);
      const base = {
        batchId: b.batch,
        shiftId: b.shift,
        source: "CAMERA" as const,
        modelVersion,
        predictedVerdict: "OK" as const,
        confidence: 0.9,
        thresholdApplied: 0.2437,
        imageKey: buildImageKey(b.company),
        capturedAt: new Date(),
      };
      await expectDenied(inspections.recordInspection(deps, actor, { ...base, batchId: a.batch }));
      await expectDenied(inspections.recordInspection(deps, actor, { ...base, shiftId: a.shift }));
      await expectDenied(inspections.recordInspection(deps, actor, { ...base, imageKey: a.imageKey }));
      expect(await db.inspection.count({ where: { companyId: a.company } })).toBe(1);
    });

    it("no se reutiliza el clientId de una inspección de otra empresa", async () => {
      const result = inspections.recordInspection(deps, await actorOf(b.inspector.id), {
        clientId: a.inspection,
        batchId: b.batch,
        shiftId: b.shift,
        source: "CAMERA",
        modelVersion,
        predictedVerdict: "OK",
        confidence: 0.9,
        thresholdApplied: 0.2437,
        imageKey: buildImageKey(b.company),
        capturedAt: new Date(),
      });
      await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("el historial y sus filtros solo muestran la propia empresa, aunque se filtre por ids de otra", async () => {
      const page = await history.listInspections(db, b.viewer, history.parseHistoryFilters({}));
      expect(page.rows.map((r) => r.id)).not.toContain(a.inspection);
      const filtered = await history.listInspections(
        db,
        b.viewer,
        history.parseHistoryFilters({ lote: a.batch, turno: a.shift, molde: a.mold }),
      );
      expect(filtered.rows).toHaveLength(0);
      const options = await history.getHistoryFilterOptions(db, b.viewer);
      expect(JSON.stringify(options)).not.toContain(a.batch);
      expect(JSON.stringify(options)).not.toContain(a.mold);
    });
  });

  describe("dashboard y reportes (HU37, HU38)", () => {
    it("el dashboard de B no cuenta inspecciones de A", async () => {
      const data = await dashboard.getDashboard(db, b.viewer, dashboard.parseDashboardFilters({}));
      expect(JSON.stringify(data)).not.toContain(a.mold);
      expect(JSON.stringify(data)).not.toContain("M-A");
    });

    it("no se descarga el reporte de un turno de otra empresa", async () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
      await expectDenied(reports.buildShiftReport(db, b.viewer, { fecha: today, turno: a.shift }));
      await expectDenied(reports.buildShiftReport(db, b.admin, { fecha: today, turno: a.shift }));
    });
  });

  describe("catálogos (HU31, HU33)", () => {
    it("no se editan ni desactivan piezas, moldes, lotes ni turnos de otra empresa", async () => {
      await expectDenied(catalogs.updatePart(db, b.admin, a.part, { code: "X-1", name: "Cambiada", description: "" }));
      await expectDenied(catalogs.setPartActive(db, b.admin, a.part, false));
      await expectDenied(catalogs.setMoldActive(db, b.admin, a.mold, false));
      await expectDenied(catalogs.setBatchStatus(db, b.admin, a.batch, "CLOSED"));
      await expectDenied(catalogs.deleteBatch(db, b.admin, a.batch));
      await expectDenied(catalogs.updateShift(db, b.admin, a.shift, { name: "Cambiado", startTime: "06:00", endTime: "14:00" }));
      await expectDenied(catalogs.setShiftActive(db, b.admin, a.shift, false));

      expect(await db.part.findUniqueOrThrow({ where: { id: a.part } })).toMatchObject({ name: "Pieza A", active: true });
      expect(await db.mold.findUniqueOrThrow({ where: { id: a.mold } })).toMatchObject({ active: true });
      expect(await db.batch.findUniqueOrThrow({ where: { id: a.batch } })).toMatchObject({ status: "OPEN" });
      expect(await db.shift.findUniqueOrThrow({ where: { id: a.shift } })).toMatchObject({ name: "Todo el día A", active: true });
    });

    it("no se crea un molde en una pieza de otra empresa ni un lote con un molde de otra empresa", async () => {
      await expectDenied(catalogs.createMold(db, b.admin, { partId: a.part, code: "M-INTRUSO", cavities: 1 }));
      await expectDenied(catalogs.createBatch(db, b.admin, { moldId: a.mold, code: "L-INTRUSO" }));
      expect(await db.mold.count({ where: { code: "M-INTRUSO" } })).toBe(0);
      expect(await db.batch.count({ where: { code: "L-INTRUSO" } })).toBe(0);
    });

    it("el listado de catálogos de B no contiene nada de A", async () => {
      const data = await catalogs.listCatalogs(db, b.viewer);
      const text = JSON.stringify(data);
      for (const id of [a.part, a.mold, a.batch, a.shift]) expect(text).not.toContain(id);
    });
  });

  describe("usuarios e invitaciones (HU30)", () => {
    it("no se editan, desactivan ni ven usuarios de otra empresa", async () => {
      await expectDenied(users.updatePlantUser(db, b.admin, a.inspector.id, { name: "Cambiado", role: "VIEWER" }));
      await expectDenied(users.setPlantUserActive(db, b.admin, a.inspector.id, false));
      expect(await db.user.findUniqueOrThrow({ where: { id: a.inspector.id } })).toMatchObject({ role: "INSPECTOR", active: true });
      const list = await users.listPlantUsers(db, b.admin, users.userFiltersSchema.parse({}));
      expect(JSON.stringify(list)).not.toContain(a.inspector.id);
    });

    it("no se revoca una invitación de otra empresa", async () => {
      await expectDenied(users.revokeInvitation(db, b.admin, a.invitation));
      const row = await db.invitation.findUniqueOrThrow({ where: { id: a.invitation } });
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("estaciones (HU44)", () => {
    it("no se configura, reasigna ni desactiva una estación de otra empresa", async () => {
      await expectDenied(stations.updateStation(db, b.admin, a.station, { name: "Cambiada", line: "X" }));
      await expectDenied(stations.assignBatch(db, b.admin, a.station, null));
      await expectDenied(stations.setStationActive(db, b.admin, a.station, false));
      const valid = { presenceThreshold: 0.1, motionThreshold: 0.02, stableFrames: 3, maxWaitMs: 2000, okPhotoEvery: 5, targetPiecesPerSecond: 1 };
      await expectDenied(stations.saveStationConfig(db, b.admin, a.station, valid));
      expect(await db.station.findUniqueOrThrow({ where: { id: a.station } })).toMatchObject({ active: true, name: "E-A" });
    });

    it("una estación de B no asigna su trabajo a un lote de A", async () => {
      await stations.assignBatch(db, b.admin, b.station, b.batch);
      const actor = await actorOf(b.stationUser);
      const [result] = await stations.syncStationInspections(deps, actor, [
        {
          clientId: randomUUID(),
          batchId: a.batch,
          pieceNumber: 1,
          source: "LINE",
          modelVersion,
          predictedVerdict: "OK",
          confidence: 0.9,
          thresholdApplied: 0.2437,
          inferenceMs: 100,
          warnings: [],
          capturedAt: new Date().toISOString(),
        },
      ]);
      expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await db.inspection.count({ where: { companyId: a.company } })).toBe(1);
    });

    it("el listado de estaciones de B no contiene las de A", async () => {
      const list = await stations.listStations(db, b.admin);
      expect(list.stations.map((s) => s.id)).not.toContain(a.station);
      expect(list.openBatches.map((x) => x.id)).not.toContain(a.batch);
    });
  });

  describe("empresas (HU23)", () => {
    it("un Admin de planta no ve ni modifica empresas, ni siquiera la suya", async () => {
      await expectDenied(companies.getCompany(db, b.admin, a.company));
      await expectDenied(companies.updateCompany(db, b.admin, a.company, { name: "Tomada", taxId: null, timezone: "America/Lima" }));
      await expectDenied(companies.setCompanyStatus(db, b.admin, a.company, "INACTIVE"));
      await expectDenied(companies.inviteAdmin(db, b.admin, a.company, { adminName: "Intruso", adminEmail: `${randomUUID()}@idor.test` }));
      expect(await db.company.findUniqueOrThrow({ where: { id: a.company } })).toMatchObject({ status: "ACTIVE" });
    });
  });
});
