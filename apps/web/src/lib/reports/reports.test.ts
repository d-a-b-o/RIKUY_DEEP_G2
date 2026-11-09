import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shiftReportSheets, shiftReportXlsx } from "./excel";
import { pdfSafe, shiftReportPdf } from "./pdf";
import { kpisOf, reportFileName, shiftWindow, type ShiftReport } from "./shift-report";
import { buildXlsx, columnName, escapeXml, sheetName } from "./xlsx";

/** HU38 · Reporte de fin de turno (RIKDP-49, RIKDP-206, RIKDP-207). */

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
// PNG de 1×1 px para probar las miniaturas sin depender de R2.
const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

const sample = (overrides: Partial<ShiftReport> = {}): ShiftReport => ({
  company: "Fundiciones Andinas",
  timeZone: "America/Lima",
  date: "2026-11-08",
  shift: { id: randomUUID(), name: "Noche", start: "22:00", end: "06:00", crossesMidnight: true },
  window: { from: new Date("2026-11-09T03:00:00Z"), to: new Date("2026-11-09T11:00:00Z") },
  generatedAt: new Date("2026-11-09T12:00:00Z"),
  generatedBy: "Rosa Quispe",
  kpis: kpisOf(97, 3, 1),
  bySource: [{ label: "Estación E-1", ...kpisOf(97, 3, 1) }],
  defects: [
    {
      id: randomUUID(),
      capturedAt: new Date("2026-11-09T04:00:00Z"),
      part: "IMP-150",
      mold: "M-12",
      batch: "L-2026-118",
      author: "Estación E-1",
      confidence: 0.83,
      predictedVerdict: "DEFECTIVE",
      corrected: false,
      imageKey: "empresa/2026/11/a.png",
    },
  ],
  defectsTruncated: false,
  corrections: [
    {
      inspectionId: randomUUID(),
      correctedAt: new Date("2026-11-09T05:00:00Z"),
      previousVerdict: "OK",
      newVerdict: "DEFECTIVE",
      reason: "Porosidad en el borde → no se vio en la foto",
      actor: "Ana Mamani",
    },
  ],
  ...overrides,
});

describe("ventana del turno", () => {
  it("un turno de día empieza y termina el mismo día, en hora de Lima", () => {
    expect(shiftWindow("2026-11-08", time("06:00"), time("14:00"), "America/Lima")).toEqual({
      from: new Date("2026-11-08T11:00:00Z"),
      to: new Date("2026-11-08T19:00:00Z"),
      crossesMidnight: false,
    });
  });

  it("un turno que cruza la medianoche termina al día siguiente", () => {
    expect(shiftWindow("2026-11-08", time("22:00"), time("06:00"), "America/Lima")).toEqual({
      from: new Date("2026-11-09T03:00:00Z"),
      to: new Date("2026-11-09T11:00:00Z"),
      crossesMidnight: true,
    });
  });
});

describe("KPI", () => {
  it("calcula el porcentaje de defectos y no divide entre cero", () => {
    expect(kpisOf(97, 3, 1)).toEqual({ inspected: 100, ok: 97, defective: 3, defectRate: 0.03, corrected: 1 });
    expect(kpisOf(0, 0, 0).defectRate).toBe(0);
  });
});

describe("Excel", () => {
  it("helpers: columnas, nombres de hoja y escape de XML", () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(sheetName("Reporte: noche/día [1]?")).toBe("Reporte  noche día  1");
    expect(escapeXml(`<a & "b">\u0001`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
  });

  it("genera un .xlsx válido con Resumen, Defectuosas y Correcciones", () => {
    const files = unzipSync(shiftReportXlsx(sample()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet3.xml"]),
    );
    const workbook = strFromU8(files["xl/workbook.xml"]!);
    expect(workbook).toContain('name="Resumen"');
    expect(workbook).toContain('name="Defectuosas"');
    expect(workbook).toContain('name="Correcciones"');
    const resumen = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(resumen).toContain("Fundiciones Andinas");
    expect(resumen).toContain('<c r="B12" s="2"><v>0.03</v></c>'); // % de defectos con formato de porcentaje
    expect(strFromU8(files["xl/worksheets/sheet3.xml"]!)).toContain("Porosidad en el borde → no se vio en la foto");
  });

  it("Excel y PDF parten del mismo objeto: los KPI de la hoja son los del reporte", () => {
    const [resumen] = shiftReportSheets(sample());
    const row = (label: string) => resumen!.rows.find((r) => r[0] === label)?.[1];
    expect([row("Inspeccionadas"), row("OK"), row("Defectuosas"), row("Corregidas")]).toEqual([100, 97, 3, 1]);
  });

  it("no acepta un libro vacío", () => {
    expect(() => buildXlsx([])).toThrow();
  });
});

describe("PDF", () => {
  it("reemplaza lo que Helvetica no puede dibujar y conserva el español", () => {
    expect(pdfSafe("Inspección → corrección ñ € 😀")).toBe("Inspección -> corrección ñ € ?");
  });

  it("genera un PDF A4 con miniatura de la defectuosa", async () => {
    const loaded: string[] = [];
    const bytes = await shiftReportPdf(sample(), async (key) => {
      loaded.push(key);
      return PNG_1PX;
    });
    expect(strFromU8(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    expect(loaded).toEqual(["empresa/2026/11/a.png"]);
  });

  it("si una foto no se puede bajar, el PDF se genera igual", async () => {
    const bytes = await shiftReportPdf(sample(), async () => {
      throw new Error("R2 caído");
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("muchas defectuosas pasan a varias páginas", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...sample().defects[0]!, id: randomUUID(), imageKey: null, part: `P-${i}` }));
    const bytes = await shiftReportPdf(sample({ defects: many, kpis: kpisOf(0, 120, 0) }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });
});

it("nombre de archivo sin tildes ni espacios", () => {
  expect(reportFileName({ date: "2026-11-08", shift: { name: "Mañana Turno 1" } as ShiftReport["shift"] }, "pdf")).toBe(
    "reporte-turno-2026-11-08-manana-turno-1.pdf",
  );
});

describe.skipIf(!process.env.DATABASE_URL)("reporte de turno contra Postgres (HU38)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError, setDeniedAccessLogger } = await import("@/lib/authz");
  const { buildShiftReport, ReportError } = await import("./shift-report");
  type AuthzUser = import("@/lib/authz").AuthzUser;

  const db = getDb();
  const companies: string[] = [];
  const modelVersion = `0.0.0-hu38-${randomUUID()}`;
  let ctx: { admin: AuthzUser; viewer: AuthzUser; inspector: AuthzUser; outsider: AuthzUser; night: string; otherShift: string };

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    const mv = await db.modelVersion.create({
      data: { version: modelVersion, artifactPath: "t/m.json", inputSize: 400, decisionThreshold: "0.2437" },
    });
    const company = await db.company.create({ data: { name: `HU38 ${randomUUID()}`, timezone: "America/Lima" } });
    const other = await db.company.create({ data: { name: `HU38 otra ${randomUUID()}`, timezone: "America/Lima" } });
    companies.push(company.id, other.id);
    const part = await db.part.create({ data: { companyId: company.id, code: "IMP-150", name: "Impulsor" } });
    const mold = await db.mold.create({ data: { companyId: company.id, partId: part.id, code: "M-12" } });
    const batch = await db.batch.create({ data: { companyId: company.id, moldId: mold.id, code: "L-118" } });
    const night = await db.shift.create({
      data: { companyId: company.id, name: "Noche", startTime: time("22:00"), endTime: time("06:00") },
    });
    const otherShift = await db.shift.create({
      data: { companyId: other.id, name: "Noche", startTime: time("22:00"), endTime: time("06:00") },
    });
    const inspectorUser = await db.user.create({
      data: { id: randomUUID(), companyId: company.id, role: "INSPECTOR", name: "Ana Mamani", email: `${randomUUID()}@hu38.test` },
    });
    const stationUser = await db.user.create({
      data: { id: randomUUID(), companyId: company.id, role: "STATION", name: "E-1", email: `${randomUUID()}@hu38.test` },
    });
    const station = await db.station.create({
      data: { companyId: company.id, userId: stationUser.id, name: "Estación E-1", line: "Línea 1" },
    });

    const base = {
      companyId: company.id,
      batchId: batch.id,
      shiftId: night.id,
      moldId: mold.id,
      partId: part.id,
      modelVersionId: mv.id,
      confidence: "0.9",
      thresholdApplied: "0.2437",
    };
    // Turno noche del 8/11: de 22:00 del 8 a 06:00 del 9 (hora de Lima) = 03:00–11:00 UTC del 9.
    const inShift = (h: number) => new Date(Date.UTC(2026, 10, 9, h));
    const rows = [
      // 4 OK de la estación, 1 defectuosa de la estación y 1 defectuosa manual.
      ...[3, 4, 5, 6].map((h) => ({ ...base, stationId: station.id, source: "LINE" as const, predictedVerdict: "OK" as const, currentVerdict: "OK" as const, capturedAt: inShift(h) })),
      { ...base, stationId: station.id, source: "LINE" as const, predictedVerdict: "DEFECTIVE" as const, currentVerdict: "DEFECTIVE" as const, imageKey: `${company.id}/d1.jpg`, capturedAt: inShift(7) },
      { ...base, inspectorId: inspectorUser.id, source: "CAMERA" as const, predictedVerdict: "DEFECTIVE" as const, currentVerdict: "DEFECTIVE" as const, imageKey: `${company.id}/d2.jpg`, capturedAt: inShift(10) },
      // Fuera de la ventana: 11:00 UTC del 9 (06:00 Lima, ya terminó) y 02:00 UTC del 9 (21:00 Lima del 8, aún no empieza).
      { ...base, stationId: station.id, source: "LINE" as const, predictedVerdict: "OK" as const, currentVerdict: "OK" as const, capturedAt: inShift(11) },
      { ...base, stationId: station.id, source: "LINE" as const, predictedVerdict: "OK" as const, currentVerdict: "OK" as const, capturedAt: inShift(2) },
    ];
    const created = [];
    for (const data of rows) created.push(await db.inspection.create({ data }));
    // La primera OK de la estación se corrigió a defectuosa.
    await db.inspection.update({ where: { id: created[0]!.id }, data: { currentVerdict: "DEFECTIVE", correctedAt: new Date() } });
    await db.inspectionEvent.create({
      data: {
        companyId: company.id,
        inspectionId: created[0]!.id,
        type: "CORRECTED",
        previousVerdict: "OK",
        newVerdict: "DEFECTIVE",
        reason: "Rebaba no detectada",
        actorId: inspectorUser.id,
      },
    });

    ctx = {
      admin: { id: randomUUID(), role: "ADMIN", empresaId: company.id },
      viewer: { id: randomUUID(), role: "VIEWER", empresaId: company.id },
      inspector: { id: inspectorUser.id, role: "INSPECTOR", empresaId: company.id },
      outsider: { id: randomUUID(), role: "ADMIN", empresaId: other.id },
      night: night.id,
      otherShift: otherShift.id,
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

  it("cuenta solo el turno, incluido el tramo después de medianoche", async () => {
    const report = await buildShiftReport(db, ctx.admin, { fecha: "2026-11-08", turno: ctx.night });
    expect(report.shift).toMatchObject({ name: "Noche", start: "22:00", end: "06:00", crossesMidnight: true });
    // 6 dentro: 3 OK vigentes (una de las 4 se corrigió), 3 defectuosas.
    expect(report.kpis).toEqual({ inspected: 6, ok: 3, defective: 3, defectRate: 0.5, corrected: 1 });
  });

  it("separa estación e inspección manual", async () => {
    const report = await buildShiftReport(db, ctx.viewer, { fecha: "2026-11-08", turno: ctx.night });
    expect(report.bySource).toEqual([
      { label: "Estación E-1", inspected: 5, ok: 3, defective: 2, defectRate: 0.4, corrected: 1 },
      { label: "Inspección manual", inspected: 1, ok: 0, defective: 1, defectRate: 1, corrected: 0 },
    ]);
  });

  it("lista las defectuosas y las correcciones con su motivo", async () => {
    const report = await buildShiftReport(db, ctx.admin, { fecha: "2026-11-08", turno: ctx.night });
    expect(report.defects).toHaveLength(3);
    expect(report.defects.filter((d) => d.corrected)).toHaveLength(1);
    expect(report.corrections).toEqual([
      expect.objectContaining({ previousVerdict: "OK", newVerdict: "DEFECTIVE", reason: "Rebaba no detectada", actor: "Ana Mamani" }),
    ]);
  });

  it("solo Admin de planta y Visualizador pueden generarlo (criterio 3)", async () => {
    await expect(buildShiftReport(db, ctx.inspector, { fecha: "2026-11-08", turno: ctx.night })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("no da acceso a turnos de otra empresa", async () => {
    await expect(buildShiftReport(db, ctx.outsider, { fecha: "2026-11-08", turno: ctx.night })).rejects.toBeInstanceOf(ReportError);
    await expect(buildShiftReport(db, ctx.admin, { fecha: "2026-11-08", turno: ctx.otherShift })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rechaza una fecha mal formada", async () => {
    await expect(buildShiftReport(db, ctx.admin, { fecha: "08/11/2026", turno: ctx.night })).rejects.toMatchObject({
      code: "INVALID",
    });
  });
});
