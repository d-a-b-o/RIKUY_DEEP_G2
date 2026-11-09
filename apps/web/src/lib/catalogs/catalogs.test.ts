import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { partSchema, shiftSchema, shiftsOverlap } from "./schema";

/** HU31 · Catálogos (RIKDP-42) y HU33 · Lotes y turnos (RIKDP-44). */

describe("validación", () => {
  it("normaliza el código a mayúsculas y rechaza caracteres raros", () => {
    expect(partSchema.parse({ code: " imp-150 ", name: "Impulsor" })).toMatchObject({ code: "IMP-150", description: null });
    expect(partSchema.safeParse({ code: "<script>", name: "Impulsor" }).success).toBe(false);
  });

  it("un turno necesita horas válidas y distintas", () => {
    expect(shiftSchema.safeParse({ name: "Noche", startTime: "22:00", endTime: "06:00" }).success).toBe(true);
    expect(shiftSchema.safeParse({ name: "X", startTime: "08:00", endTime: "08:00" }).success).toBe(false);
    expect(shiftSchema.safeParse({ name: "X", startTime: "25:00", endTime: "08:00" }).success).toBe(false);
  });

  it.each([
    ["06:00", "14:00", "14:00", "22:00", false], // contiguos
    ["06:00", "14:00", "13:00", "22:00", true],
    ["22:00", "06:00", "06:00", "14:00", false], // noche y mañana contiguos
    ["22:00", "06:00", "05:00", "13:00", true], // se cruzan pasada la medianoche
    ["22:00", "06:00", "21:00", "23:00", true],
    ["22:00", "02:00", "23:00", "01:00", true], // los dos cruzan la medianoche
  ])("%s–%s y %s–%s se superponen: %s", (s1, e1, s2, e2, expected) => {
    expect(shiftsOverlap({ startTime: s1, endTime: e1 }, { startTime: s2, endTime: e2 })).toBe(expected);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("catálogos contra Postgres (HU31, HU33)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError, setDeniedAccessLogger } = await import("@/lib/authz");
  const svc = await import("./service");
  type AuthzUser = import("@/lib/authz").AuthzUser;

  const db = getDb();
  const companies: string[] = [];
  const modelVersion = `0.0.0-hu31-${randomUUID()}`;
  let admin: AuthzUser;
  let inspector: AuthzUser;
  let otherAdmin: AuthzUser;

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    const a = await db.company.create({ data: { name: `HU31 A ${randomUUID()}`, timezone: "America/Lima" } });
    const b = await db.company.create({ data: { name: `HU31 B ${randomUUID()}`, timezone: "America/Lima" } });
    companies.push(a.id, b.id);
    const adminUser = await db.user.create({
      data: { id: randomUUID(), companyId: a.id, role: "ADMIN", name: "Admin A", email: `${randomUUID()}@hu31.test` },
    });
    admin = { id: adminUser.id, role: "ADMIN", empresaId: a.id };
    inspector = { id: randomUUID(), role: "INSPECTOR", empresaId: a.id };
    otherAdmin = { id: randomUUID(), role: "ADMIN", empresaId: b.id };
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
    await db.batch.deleteMany({ where: { companyId: { in: companies } } });
    await db.mold.deleteMany({ where: { companyId: { in: companies } } });
    await db.part.deleteMany({ where: { companyId: { in: companies } } });
    await db.shift.deleteMany({ where: { companyId: { in: companies } } });
    await db.user.deleteMany({ where: { companyId: { in: companies } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.modelVersion.deleteMany({ where: { version: modelVersion } });
  });

  it("CRUD de piezas y moldes asociados (HU31, criterio 1)", async () => {
    const part = await svc.createPart(db, admin, { code: "imp-150", name: "Impulsor 150" });
    expect(part.code).toBe("IMP-150");
    await expect(svc.createPart(db, admin, { code: "IMP-150", name: "Otra" })).rejects.toMatchObject({
      code: "DUPLICATE",
      fields: { code: expect.any(String) },
    });
    await svc.updatePart(db, admin, part.id, { code: "IMP-150", name: "Impulsor de bomba 150 mm", description: "Aluminio" });
    const mold = await svc.createMold(db, admin, { partId: part.id, code: "M-12", cavities: "2" });
    expect(mold).toMatchObject({ partId: part.id, cavities: 2 });

    const catalogs = await svc.listCatalogs(db, inspector);
    expect(catalogs.parts.find((p) => p.id === part.id)).toMatchObject({
      name: "Impulsor de bomba 150 mm",
      molds: [expect.objectContaining({ code: "M-12" })],
    });
  });

  it("aísla por empresa: nadie ve ni toca catálogos de otra (HU31, criterio 3)", async () => {
    const part = await svc.createPart(db, admin, { code: "SOLO-A", name: "Solo de A" });
    const fromB = await svc.listCatalogs(db, otherAdmin);
    expect(fromB.parts.some((p) => p.id === part.id)).toBe(false);
    await expect(svc.updatePart(db, otherAdmin, part.id, { code: "HACK", name: "Hack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.createMold(db, otherAdmin, { partId: part.id, code: "M-X", cavities: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // El mismo código sí puede existir en otra empresa.
    await expect(svc.createPart(db, otherAdmin, { code: "SOLO-A", name: "De B" })).resolves.toMatchObject({ code: "SOLO-A" });
  });

  it("solo el Admin de planta modifica", async () => {
    await expect(svc.createPart(db, inspector, { code: "NO", name: "No" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("turnos: detecta el activo, incluido el que cruza la medianoche, y evita superposiciones (HU31 c2, HU33-T02)", async () => {
    await svc.createShift(db, admin, { name: "Mañana", startTime: "06:00", endTime: "14:00" });
    await svc.createShift(db, admin, { name: "Tarde", startTime: "14:00", endTime: "22:00" });
    const night = await svc.createShift(db, admin, { name: "Noche", startTime: "22:00", endTime: "06:00" });
    await expect(svc.createShift(db, admin, { name: "Extra", startTime: "05:00", endTime: "07:00" })).rejects.toMatchObject({
      code: "OVERLAP",
    });

    // 02:30 en Lima = 07:30 UTC → turno noche.
    const at = await svc.listCatalogs(db, admin, new Date("2026-11-09T07:30:00Z"));
    expect(at.activeShiftId).toBe(night.id);
    expect(at.shifts.find((s) => s.id === night.id)).toMatchObject({ crossesMidnight: true, start: "22:00", end: "06:00" });

    // Desactivado deja de ser el activo y libera su horario.
    await svc.setShiftActive(db, admin, night.id, false);
    expect((await svc.listCatalogs(db, admin, new Date("2026-11-09T07:30:00Z"))).activeShiftId).toBeNull();
    const extra = await svc.createShift(db, admin, { name: "Madrugada", startTime: "00:00", endTime: "06:00" });
    await expect(svc.setShiftActive(db, admin, night.id, true)).rejects.toMatchObject({ code: "OVERLAP" });
    await svc.updateShift(db, admin, extra.id, { name: "Madrugada", startTime: "01:00", endTime: "05:00" });
  });

  it("lotes: abrir, cerrar, reabrir y no eliminar si tienen inspecciones (HU33)", async () => {
    const part = await svc.createPart(db, admin, { code: "LOT-P", name: "Pieza de lotes" });
    const mold = await svc.createMold(db, admin, { partId: part.id, code: "LOT-M", cavities: 1 });
    const empty = await svc.createBatch(db, admin, { moldId: mold.id, code: "L-vacio" });
    const used = await svc.createBatch(db, admin, { moldId: mold.id, code: "L-usado" });
    expect(empty).toMatchObject({ code: "L-VACIO", status: "OPEN", openedById: admin.id });

    await svc.setBatchStatus(db, admin, used.id, "CLOSED");
    expect(await db.batch.findUnique({ where: { id: used.id } })).toMatchObject({ status: "CLOSED", closedAt: expect.any(Date) });
    await svc.setBatchStatus(db, admin, used.id, "OPEN");
    expect(await db.batch.findUnique({ where: { id: used.id } })).toMatchObject({ status: "OPEN", closedAt: null });

    const shift = await db.shift.findFirstOrThrow({ where: { companyId: admin.empresaId!, name: "Mañana" } });
    const mv = await db.modelVersion.create({
      data: { version: modelVersion, artifactPath: "t/m.json", inputSize: 400, decisionThreshold: "0.2437" },
    });
    await db.inspection.create({
      data: {
        companyId: admin.empresaId!,
        batchId: used.id,
        shiftId: shift.id,
        moldId: mold.id,
        partId: part.id,
        inspectorId: admin.id,
        modelVersionId: mv.id,
        source: "CAMERA",
        predictedVerdict: "OK",
        currentVerdict: "OK",
        confidence: "0.9",
        thresholdApplied: "0.2437",
        imageKey: `${admin.empresaId}/x.jpg`,
        capturedAt: new Date(),
      },
    });

    await expect(svc.deleteBatch(db, admin, used.id)).rejects.toMatchObject({ code: "HAS_INSPECTIONS" });
    await svc.deleteBatch(db, admin, empty.id);
    expect(await db.batch.findUnique({ where: { id: empty.id } })).toBeNull();
    await expect(svc.deleteBatch(db, otherAdmin, used.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const listed = (await svc.listCatalogs(db, admin)).batches.find((b) => b.id === used.id);
    expect(listed).toMatchObject({ inspections: 1 });
  });

  it("no abre lotes en moldes inactivos", async () => {
    const part = await svc.createPart(db, admin, { code: "INA-P", name: "Pieza" });
    const mold = await svc.createMold(db, admin, { partId: part.id, code: "INA-M", cavities: 1 });
    await svc.setMoldActive(db, admin, mold.id, false);
    await expect(svc.createBatch(db, admin, { moldId: mold.id, code: "L-ina" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
