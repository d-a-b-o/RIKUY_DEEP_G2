import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integración de HU24 (RIKDP-35) contra Postgres: registro inmutable con su
 * evento, foto obligatoria, aislamiento por empresa, turno activo y
 * correcciones como eventos. R2 se simula; la firma de URLs se prueba en
 * src/lib/storage.
 */
describe.skipIf(!process.env.DATABASE_URL)("trazabilidad de inspecciones (HU24)", async () => {
  const { getDb } = await import("@/lib/db");
  const { buildImageKey } = await import("@/lib/storage/r2");
  const { correctVerdict, getInspectionTrace, InspectionError, loadActor, recordInspection } = await import("./service");
  type Actor = import("./service").Actor;

  const db = getDb();
  const uploaded = new Set<string>();
  const deps = {
    db,
    imageExists: async (key: string) => uploaded.has(key),
    storageConfigured: () => true,
  };

  const companies: string[] = [];
  const modelVersion = `0.0.0-hu24-${randomUUID()}`;
  let ctx: {
    company: string;
    other: string;
    batch: string;
    closedBatch: string;
    otherBatch: string;
    morning: string;
    night: string;
    inspector: Actor;
    admin: Actor;
    viewer: Actor;
    station: Actor;
    outsider: Actor;
  };

  async function newCompany(name: string) {
    const company = await db.company.create({ data: { name, timezone: "America/Lima" } });
    companies.push(company.id);
    const part = await db.part.create({ data: { companyId: company.id, code: "P-1", name: "Impulsor" } });
    const mold = await db.mold.create({ data: { companyId: company.id, partId: part.id, code: "M-1" } });
    const batch = await db.batch.create({ data: { companyId: company.id, moldId: mold.id, code: "L-1" } });
    return { company, part, mold, batch };
  }

  async function newUser(companyId: string | null, role: "INSPECTOR" | "ADMIN" | "VIEWER" | "STATION") {
    return db.user.create({
      data: { id: randomUUID(), companyId, role, name: `${role} de prueba`, email: `${randomUUID()}@hu24.test` },
    });
  }

  async function actorOf(userId: string): Promise<Actor> {
    const actor = await loadActor(db, userId);
    if (!actor) throw new Error("actor no encontrado");
    return actor;
  }

  function upload(companyId = ctx.company): string {
    const key = buildImageKey(companyId);
    uploaded.add(key);
    return key;
  }

  /** Inspección manual válida; cada prueba cambia lo que necesita. */
  const manual = (overrides: Record<string, unknown> = {}) => ({
    batchId: ctx.batch,
    shiftId: ctx.morning,
    source: "CAMERA" as const,
    modelVersion,
    predictedVerdict: "OK" as const,
    confidence: 0.91234,
    thresholdApplied: 0.2437,
    imageKey: upload(),
    capturedAt: new Date(),
    ...overrides,
  });

  async function expectCode(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toBeInstanceOf(InspectionError);
    await expect(promise).rejects.toMatchObject({ code });
  }

  beforeAll(async () => {
    const a = await newCompany(`HU24 A ${randomUUID()}`);
    const b = await newCompany(`HU24 B ${randomUUID()}`);
    const closed = await db.batch.create({
      data: { companyId: a.company.id, moldId: a.mold.id, code: "L-cerrado", status: "CLOSED", closedAt: new Date() },
    });
    const morning = await db.shift.create({
      data: { companyId: a.company.id, name: "Mañana", startTime: new Date("1970-01-01T06:00:00Z"), endTime: new Date("1970-01-01T14:00:00Z") },
    });
    const night = await db.shift.create({
      data: { companyId: a.company.id, name: "Noche", startTime: new Date("1970-01-01T22:00:00Z"), endTime: new Date("1970-01-01T06:00:00Z") },
    });
    await db.modelVersion.create({
      data: { version: modelVersion, artifactPath: "test/model.json", inputSize: 400, decisionThreshold: "0.2437" },
    });

    const stationUser = await newUser(a.company.id, "STATION");
    await db.station.create({
      data: { companyId: a.company.id, userId: stationUser.id, name: "E-1", line: "Línea 1", currentBatchId: a.batch.id },
    });

    ctx = {
      company: a.company.id,
      other: b.company.id,
      batch: a.batch.id,
      closedBatch: closed.id,
      otherBatch: b.batch.id,
      morning: morning.id,
      night: night.id,
      inspector: await actorOf((await newUser(a.company.id, "INSPECTOR")).id),
      admin: await actorOf((await newUser(a.company.id, "ADMIN")).id),
      viewer: await actorOf((await newUser(a.company.id, "VIEWER")).id),
      station: await actorOf(stationUser.id),
      outsider: await actorOf((await newUser(b.company.id, "INSPECTOR")).id),
    };
  });

  afterAll(async () => {
    // Las inspecciones son inmutables (ADR 0004): para limpiar los datos de prueba
    // se desactivan los triggers dentro de una transacción, como haría el
    // procedimiento controlado de plataforma. Si algo falla, todo se revierte.
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

  describe("registro (criterio 1)", () => {
    it("guarda todos los campos de trazabilidad y el evento CREATED", async () => {
      const imageKey = upload();
      const { id, duplicate } = await recordInspection(deps, ctx.inspector, manual({
        imageKey,
        imageSha256: "a".repeat(64),
        inferenceMs: 142,
        backend: "WEBGL",
        warnings: ["movimiento"],
      }));
      expect(duplicate).toBe(false);

      const row = await db.inspection.findUniqueOrThrow({ where: { id }, include: { events: true, batch: { include: { mold: true } } } });
      expect(row).toMatchObject({
        companyId: ctx.company,
        batchId: ctx.batch,
        shiftId: ctx.morning,
        moldId: row.batch.moldId,
        partId: row.batch.mold.partId,
        inspectorId: ctx.inspector.userId,
        stationId: null,
        source: "CAMERA",
        predictedVerdict: "OK",
        currentVerdict: "OK",
        imageKey,
        inferenceMs: 142,
        backend: "WEBGL",
        warnings: ["movimiento"],
      });
      expect(row.confidence.toString()).toBe("0.9123");
      expect(row.thresholdApplied.toString()).toBe("0.2437");
      expect(row.events).toHaveLength(1);
      expect(row.events[0]).toMatchObject({ type: "CREATED", newVerdict: "OK", actorId: ctx.inspector.userId });
    });

    it("la estación registra como estación, con número de pieza y sin foto si es OK", async () => {
      const { id } = await recordInspection(deps, ctx.station, manual({
        source: "LINE",
        imageKey: undefined,
        pieceNumber: 37,
      }));
      const row = await db.inspection.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ inspectorId: null, stationId: ctx.station.stationId, pieceNumber: 37, imageKey: null });
    });

    it("detecta el turno por la hora de captura en la zona de la empresa, incluso de noche", async () => {
      // 03:30 UTC = 22:30 en Lima: turno Noche.
      const capturedAt = new Date(Date.now() - 60_000);
      capturedAt.setUTCHours(3, 30, 0, 0);
      if (capturedAt.getTime() > Date.now()) capturedAt.setUTCDate(capturedAt.getUTCDate() - 1);
      const { id } = await recordInspection(deps, ctx.inspector, manual({ shiftId: undefined, capturedAt }));
      expect((await db.inspection.findUniqueOrThrow({ where: { id } })).shiftId).toBe(ctx.night);
    });

    it("es idempotente con clientId: un reintento no duplica la inspección", async () => {
      const clientId = randomUUID();
      const input = manual({ clientId });
      const first = await recordInspection(deps, ctx.inspector, input);
      const retry = await recordInspection(deps, ctx.inspector, input);
      expect(first).toEqual({ id: clientId, duplicate: false });
      expect(retry).toEqual({ id: clientId, duplicate: true });
      expect(await db.inspectionEvent.count({ where: { inspectionId: clientId } })).toBe(1);
    });
  });

  describe("foto en R2 (criterio 2)", () => {
    it("es obligatoria en inspecciones manuales y en defectuosas de estación", async () => {
      await expectCode(recordInspection(deps, ctx.inspector, manual({ imageKey: undefined })), "IMAGE_REQUIRED");
      await expectCode(
        recordInspection(deps, ctx.station, manual({ source: "LINE", predictedVerdict: "DEFECTIVE", confidence: 0.8, imageKey: undefined })),
        "IMAGE_REQUIRED",
      );
    });

    it("rechaza una foto que no se subió", async () => {
      await expectCode(recordInspection(deps, ctx.inspector, manual({ imageKey: buildImageKey(ctx.company) })), "IMAGE_NOT_FOUND");
    });

    it("rechaza la clave de una foto de otra empresa", async () => {
      await expectCode(recordInspection(deps, ctx.inspector, manual({ imageKey: upload(ctx.other) })), "FORBIDDEN");
    });

    it("no registra si el almacenamiento no está configurado", async () => {
      await expectCode(
        recordInspection({ ...deps, storageConfigured: () => false }, ctx.inspector, manual()),
        "STORAGE_NOT_CONFIGURED",
      );
    });
  });

  describe("autor y aislamiento por empresa", () => {
    it("el visualizador no registra; la estación no registra manuales ni las personas como estación", async () => {
      await expectCode(recordInspection(deps, ctx.viewer, manual()), "FORBIDDEN");
      await expectCode(recordInspection(deps, ctx.station, manual()), "FORBIDDEN");
      await expectCode(recordInspection(deps, ctx.inspector, manual({ source: "LINE" })), "FORBIDDEN");
    });

    it("no se puede usar el lote ni el turno de otra empresa", async () => {
      await expectCode(recordInspection(deps, ctx.outsider, manual({ imageKey: upload(ctx.other) })), "NOT_FOUND");
      await expectCode(recordInspection(deps, ctx.inspector, manual({ batchId: ctx.otherBatch })), "NOT_FOUND");
    });

    it("solo se registra en lotes abiertos", async () => {
      await expectCode(recordInspection(deps, ctx.inspector, manual({ batchId: ctx.closedBatch })), "BATCH_CLOSED");
    });

    it("rechaza versiones de modelo desconocidas y horas de captura imposibles", async () => {
      await expectCode(recordInspection(deps, ctx.inspector, manual({ modelVersion: "9.9.9" })), "UNKNOWN_MODEL");
      await expectCode(
        recordInspection(deps, ctx.inspector, manual({ capturedAt: new Date(Date.now() + 60 * 60 * 1000) })),
        "INVALID",
      );
      await expectCode(recordInspection(deps, ctx.inspector, manual({ confidence: 1.5 })), "INVALID");
    });
  });

  describe("inmutabilidad y correcciones (criterio 3)", () => {
    it("la base de datos impide editar o borrar el registro", async () => {
      const { id } = await recordInspection(deps, ctx.inspector, manual());
      await expect(db.inspection.update({ where: { id }, data: { predictedVerdict: "DEFECTIVE" } })).rejects.toThrow();
      await expect(db.inspection.delete({ where: { id } })).rejects.toThrow();
      await expect(db.inspectionEvent.deleteMany({ where: { inspectionId: id } })).rejects.toThrow();

      const row = await db.inspection.findUniqueOrThrow({ where: { id }, include: { events: true } });
      expect(row.predictedVerdict).toBe("OK");
      expect(row.events).toHaveLength(1);
    });

    it("una corrección crea eventos nuevos y conserva el veredicto original", async () => {
      const { id } = await recordInspection(deps, ctx.inspector, manual());
      await expect(
        correctVerdict(deps, ctx.admin, { inspectionId: id, newVerdict: "DEFECTIVE", reason: "Rebaba visible en el borde" }),
      ).resolves.toEqual({ id, currentVerdict: "DEFECTIVE" });

      const row = await db.inspection.findUniqueOrThrow({
        where: { id },
        include: { events: { orderBy: { createdAt: "asc" } } },
      });
      expect(row.predictedVerdict).toBe("OK");
      expect(row.currentVerdict).toBe("DEFECTIVE");
      expect(row.correctedAt).toBeInstanceOf(Date);
      expect(row.events.map((e) => e.type)).toEqual(["CREATED", "CORRECTED", "FLAGGED_FOR_RETRAINING"]);
      expect(row.events[1]).toMatchObject({
        previousVerdict: "OK",
        newVerdict: "DEFECTIVE",
        reason: "Rebaba visible en el borde",
        actorId: ctx.admin.userId,
      });
    });

    it("exige motivo, un veredicto distinto, el rol adecuado y la misma empresa", async () => {
      const { id } = await recordInspection(deps, ctx.inspector, manual());
      await expectCode(correctVerdict(deps, ctx.inspector, { inspectionId: id, newVerdict: "DEFECTIVE", reason: " " }), "INVALID");
      await expectCode(correctVerdict(deps, ctx.inspector, { inspectionId: id, newVerdict: "OK", reason: "Sin cambios" }), "INVALID");
      await expectCode(correctVerdict(deps, ctx.viewer, { inspectionId: id, newVerdict: "DEFECTIVE", reason: "Motivo" }), "FORBIDDEN");
      await expectCode(correctVerdict(deps, ctx.outsider, { inspectionId: id, newVerdict: "DEFECTIVE", reason: "Motivo" }), "NOT_FOUND");
    });
  });

  describe("consulta de la trazabilidad", () => {
    it("devuelve el contexto completo, la historia de eventos y una URL de lectura firmada", async () => {
      const { id } = await recordInspection(deps, ctx.inspector, manual());
      await correctVerdict(deps, ctx.inspector, { inspectionId: id, newVerdict: "DEFECTIVE", reason: "Poro en la cara" });

      const r2Env = {
        R2_ENDPOINT_URL: "https://cuenta.r2.cloudflarestorage.com",
        R2_IMAGES_BUCKET: "imagenes",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secreto",
      };
      const previous = Object.fromEntries(Object.keys(r2Env).map((name) => [name, process.env[name]]));
      Object.assign(process.env, r2Env);
      try {
        const trace = await getInspectionTrace(deps, ctx.viewer, id);
        expect(trace).toMatchObject({
          batch: { code: "L-1" },
          shift: { name: "Mañana" },
          mold: { code: "M-1" },
          part: { code: "P-1", name: "Impulsor" },
          inspector: { name: "INSPECTOR de prueba" },
          modelVersion: { version: modelVersion },
        });
        expect(trace.events.map((e) => e.type)).toEqual(["CREATED", "CORRECTED", "FLAGGED_FOR_RETRAINING"]);
        expect(trace.imageUrl).toContain("X-Amz-Signature=");
      } finally {
        for (const [name, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });

    it("no muestra inspecciones de otra empresa ni a la cuenta de estación", async () => {
      const { id } = await recordInspection(deps, ctx.inspector, manual());
      await expectCode(getInspectionTrace(deps, ctx.outsider, id), "NOT_FOUND");
      await expectCode(getInspectionTrace(deps, ctx.station, id), "FORBIDDEN");
    });
  });
});
