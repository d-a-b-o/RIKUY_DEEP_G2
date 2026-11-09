import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integración de HU44 (RIKDP-55) contra Postgres: contexto de la estación,
 * envío por lotes idempotente y administración de estaciones aislada por empresa.
 */
describe.skipIf(!process.env.DATABASE_URL)("estación automática (HU44)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError } = await import("@/lib/authz");
  const { loadActor } = await import("@/lib/inspections/service");
  const { buildImageKey } = await import("@/lib/storage/r2");
  const service = await import("./service");
  type Actor = import("@/lib/inspections/service").Actor;
  type Payload = import("./queue").SyncPayload;

  const db = getDb();
  const companies: string[] = [];
  const modelVersion = `0.0.0-hu44-${randomUUID()}`;
  const limits = { min: 10, max: 128 };
  const deps = { db, imageExists: async () => true, storageConfigured: () => true };

  let ctx: {
    company: string;
    other: string;
    batch: string;
    closedBatch: string;
    otherBatch: string;
    shift: string;
    admin: { id: string; role: "ADMIN"; empresaId: string };
    otherAdmin: { id: string; role: "ADMIN"; empresaId: string };
    inspector: { id: string; role: "INSPECTOR"; empresaId: string };
  };

  async function newCompany(name: string) {
    const company = await db.company.create({ data: { name, timezone: "America/Lima" } });
    companies.push(company.id);
    const part = await db.part.create({ data: { companyId: company.id, code: "P-1", name: "Impulsor" } });
    const mold = await db.mold.create({ data: { companyId: company.id, partId: part.id, code: "M-1" } });
    const batch = await db.batch.create({ data: { companyId: company.id, moldId: mold.id, code: "L-1" } });
    return { company, mold, batch };
  }

  async function newUser(companyId: string, role: "ADMIN" | "INSPECTOR") {
    const user = await db.user.create({
      data: { id: randomUUID(), companyId, role, name: `${role} de prueba`, email: `${randomUUID()}@hu44.test` },
    });
    return { id: user.id, role, empresaId: companyId };
  }

  async function newStation(name = `E-${randomUUID().slice(0, 6)}`) {
    const email = `${randomUUID()}@estacion.hu44.test`;
    const { id } = await service.createStation(db, ctx.admin, { name, line: "Línea A", email, password: "una-clave-larga" }, limits);
    const station = await db.station.findUniqueOrThrow({ where: { id } });
    return { id, userId: station.userId!, email };
  }

  async function actorOf(userId: string): Promise<Actor> {
    const actor = await loadActor(db, userId);
    if (!actor) throw new Error("actor no encontrado");
    return actor;
  }

  let piece = 0;
  const payload = (overrides: Partial<Payload> = {}): Payload => ({
    clientId: randomUUID(),
    batchId: ctx.batch,
    pieceNumber: ++piece,
    source: "LINE",
    modelVersion,
    predictedVerdict: "OK",
    confidence: 0.93,
    thresholdApplied: 0.2437,
    inferenceMs: 180,
    backend: "WEBGL",
    warnings: [],
    capturedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    const a = await newCompany(`HU44 A ${randomUUID()}`);
    const b = await newCompany(`HU44 B ${randomUUID()}`);
    const closed = await db.batch.create({
      data: { companyId: a.company.id, moldId: a.mold.id, code: "L-cerrado", status: "CLOSED", closedAt: new Date() },
    });
    const shift = await db.shift.create({
      data: { companyId: a.company.id, name: "Todo el día", startTime: new Date("1970-01-01T00:00:00Z"), endTime: new Date("1970-01-01T23:59:00Z") },
    });
    await db.modelVersion.create({
      data: { version: modelVersion, artifactPath: "test/model.json", inputSize: 400, decisionThreshold: "0.2437" },
    });
    ctx = {
      company: a.company.id,
      other: b.company.id,
      batch: a.batch.id,
      closedBatch: closed.id,
      otherBatch: b.batch.id,
      shift: shift.id,
      admin: (await newUser(a.company.id, "ADMIN")) as typeof ctx.admin,
      otherAdmin: (await newUser(b.company.id, "ADMIN")) as typeof ctx.otherAdmin,
      inspector: (await newUser(a.company.id, "INSPECTOR")) as typeof ctx.inspector,
    };
  });

  afterAll(async () => {
    await db.$transaction([
      db.$executeRawUnsafe(`ALTER TABLE "inspection_event" DISABLE TRIGGER "inspection_event_append_only"`),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" DISABLE TRIGGER "inspection_immutable"`),
      db.inspectionEvent.deleteMany({ where: { companyId: { in: companies } } }),
      db.inspection.deleteMany({ where: { companyId: { in: companies } } }),
      db.$executeRawUnsafe(`ALTER TABLE "inspection" ENABLE TRIGGER "inspection_immutable"`),
      db.$executeRawUnsafe(`ALTER TABLE "inspection_event" ENABLE TRIGGER "inspection_event_append_only"`),
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

  describe("administración (HU44-T04)", () => {
    it("crea la estación con su cuenta técnica STATION en la empresa del admin", async () => {
      const station = await newStation();
      const user = await db.user.findUniqueOrThrow({ where: { id: station.userId }, include: { accounts: true } });
      expect(user).toMatchObject({ role: "STATION", companyId: ctx.company, email: station.email });
      expect(user.accounts[0]).toMatchObject({ providerId: "credential" });
      expect(user.accounts[0].password).not.toContain("una-clave-larga");
    });

    it("rechaza nombres repetidos, correos en uso y datos no válidos", async () => {
      const station = await newStation("E-repetida");
      await expect(newStation("E-repetida")).rejects.toMatchObject({ code: "DUPLICATE" });
      await expect(
        service.createStation(db, ctx.admin, { name: "E-x", line: "A", email: station.email, password: "una-clave-larga" }, limits),
      ).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
      await expect(
        service.createStation(db, ctx.admin, { name: "E", line: "", email: "no", password: "corta" }, limits),
      ).rejects.toMatchObject({ code: "INVALID", fields: { name: expect.any(String), line: expect.any(String), email: expect.any(String), password: expect.any(String) } });
    });

    it("solo el Admin de planta gestiona estaciones, y solo las de su empresa", async () => {
      const station = await newStation();
      await expect(service.listStations(db, ctx.inspector)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.assignBatch(db, ctx.otherAdmin, station.id, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(service.saveStationConfig(db, ctx.otherAdmin, station.id, {})).rejects.toMatchObject({ code: "INVALID" });
      const list = await service.listStations(db, ctx.otherAdmin);
      expect(list.stations.map((s) => s.id)).not.toContain(station.id);
    });

    it("asigna solo lotes abiertos de la empresa", async () => {
      const station = await newStation();
      await expect(service.assignBatch(db, ctx.admin, station.id, ctx.otherBatch)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(service.assignBatch(db, ctx.admin, station.id, ctx.closedBatch)).rejects.toMatchObject({ code: "BATCH_CLOSED" });
      await service.assignBatch(db, ctx.admin, station.id, ctx.batch);
      expect((await db.station.findUniqueOrThrow({ where: { id: station.id } })).currentBatchId).toBe(ctx.batch);
    });

    it("guarda la configuración validada", async () => {
      const station = await newStation();
      const config = { presenceThreshold: 0.2, motionThreshold: 0.03, stableFrames: 4, maxWaitMs: 1500, okPhotoEvery: 10, targetPiecesPerSecond: 1.5 };
      await expect(service.saveStationConfig(db, ctx.admin, station.id, { ...config, stableFrames: 0 })).rejects.toMatchObject({
        code: "INVALID",
        fields: { stableFrames: "Al menos 1" },
      });
      await service.saveStationConfig(db, ctx.admin, station.id, config);
      const [row] = (await service.listStations(db, ctx.admin)).stations.filter((s) => s.id === station.id);
      expect(row.config).toEqual(config);
    });

    it("desactivar la estación cierra la sesión de su cuenta técnica y la deja sin acceso", async () => {
      const station = await newStation();
      await db.session.create({
        data: { id: randomUUID(), userId: station.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
      });
      await service.setStationActive(db, ctx.admin, station.id, false);
      expect(await db.session.count({ where: { userId: station.userId } })).toBe(0);
      expect(await loadActor(db, station.userId)).toBeNull();
      await service.setStationActive(db, ctx.admin, station.id, true);
      expect((await actorOf(station.userId)).stationId).toBe(station.id);
    });
  });

  describe("contexto y envío (criterios 1 y 5)", () => {
    it("la estación lee su lote, el turno activo por el reloj, su configuración y numeración", async () => {
      const station = await newStation();
      const actor = await actorOf(station.userId);
      const empty = await service.loadStationContext(db, actor);
      expect(empty).toMatchObject({ batch: null, shift: { id: ctx.shift }, lastPieceNumber: 0, config: { okPhotoEvery: 20 } });

      await service.assignBatch(db, ctx.admin, station.id, ctx.batch);
      const results = await service.syncStationInspections(deps, actor, [payload({ pieceNumber: 7 }), payload({ pieceNumber: 8, predictedVerdict: "DEFECTIVE", imageKey: buildImageKey(ctx.company) })]);
      expect(results.every((r) => r.ok)).toBe(true);

      const context = await service.loadStationContext(db, actor);
      expect(context).toMatchObject({
        station: { id: station.id, line: "Línea A" },
        batch: { id: ctx.batch, code: "L-1", moldCode: "M-1", partCode: "P-1" },
        lastPieceNumber: 8,
        shiftCounts: { total: 2, ok: 1, defective: 1 },
      });
      expect((await db.station.findUniqueOrThrow({ where: { id: station.id } })).lastSeenAt).not.toBeNull();
    });

    it("registra el lote con origen LINE y es idempotente al reenviarlo (sin red)", async () => {
      const station = await newStation();
      const actor = await actorOf(station.userId);
      const items = [payload(), payload()];
      expect(await service.syncStationInspections(deps, actor, items)).toEqual(items.map((i) => ({ clientId: i.clientId, ok: true })));
      expect(await service.syncStationInspections(deps, actor, items)).toEqual(items.map((i) => ({ clientId: i.clientId, ok: true })));
      const rows = await db.inspection.findMany({ where: { id: { in: items.map((i) => i.clientId) } } });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ source: "LINE", stationId: station.id, inspectorId: null, shiftId: ctx.shift });
    });

    it("informa cada rechazo sin detener el resto del lote", async () => {
      const station = await newStation();
      const actor = await actorOf(station.userId);
      const [good, closed, noPhoto] = [payload(), payload({ batchId: ctx.closedBatch }), payload({ predictedVerdict: "DEFECTIVE" })];
      const results = await service.syncStationInspections(deps, actor, [good, closed, noPhoto]);
      expect(results).toEqual([
        { clientId: good.clientId, ok: true },
        { clientId: closed.clientId, ok: false, code: "BATCH_CLOSED", message: expect.any(String) },
        { clientId: noPhoto.clientId, ok: false, code: "IMAGE_REQUIRED", message: expect.any(String) },
      ]);
    });

    it("solo una estación activa envía, y como máximo 50 por lote", async () => {
      const station = await newStation();
      const actor = await actorOf(station.userId);
      const inspector = await actorOf(ctx.inspector.id);
      await expect(service.syncStationInspections(deps, inspector, [payload()])).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.loadStationContext(db, inspector)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.syncStationInspections(deps, actor, Array.from({ length: 51 }, () => payload()))).rejects.toMatchObject({
        code: "INVALID",
      });
    });

    it("la estación guarda los umbrales de su calibración sin tocar el resto", async () => {
      const station = await newStation();
      await service.saveStationConfig(db, ctx.admin, station.id, {
        presenceThreshold: 0.12,
        motionThreshold: 0.02,
        stableFrames: 5,
        maxWaitMs: 2000,
        okPhotoEvery: 7,
        targetPiecesPerSecond: 1,
      });
      const config = await service.saveCalibration(db, await actorOf(station.userId), { presenceThreshold: 0.09, motionThreshold: 0.015 });
      expect(config).toMatchObject({ presenceThreshold: 0.09, motionThreshold: 0.015, stableFrames: 5, okPhotoEvery: 7 });
      await expect(
        service.saveCalibration(db, await actorOf(ctx.inspector.id), { presenceThreshold: 0.1, motionThreshold: 0.01 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
