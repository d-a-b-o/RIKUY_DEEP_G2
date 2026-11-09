import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";
import { addDays, startOfLocalDay } from "@/lib/inspections/history";

/**
 * HU38 · Reporte de fin de turno (RIKDP-49).
 *
 * Calcula, para un turno de un día, el resumen, los KPI, el detalle de las
 * piezas defectuosas y las correcciones. El PDF (./pdf.ts) y el Excel
 * (./xlsx.ts) se generan a partir de este mismo objeto, así que muestran los
 * mismos valores. El dashboard de HU37 debería reutilizarlo por la misma razón.
 */

export class ReportError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

export const shiftReportQuerySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha con formato AAAA-MM-DD"),
  turno: z.uuid("Elige un turno"),
});
export type ShiftReportQuery = z.infer<typeof shiftReportQuerySchema>;

/** Máximo de piezas defectuosas listadas una por una (el resumen siempre cuenta todas). */
export const MAX_DEFECT_ROWS = 500;

export type Kpis = {
  inspected: number;
  ok: number;
  defective: number;
  /** Proporción 0–1 de defectuosas sobre inspeccionadas (0 si no hubo inspecciones). */
  defectRate: number;
  corrected: number;
};

export type SourceKpis = Kpis & { label: string };

export type DefectRow = {
  id: string;
  capturedAt: Date;
  part: string;
  mold: string;
  batch: string;
  author: string;
  confidence: number;
  predictedVerdict: "OK" | "DEFECTIVE";
  corrected: boolean;
  imageKey: string | null;
};

export type CorrectionRow = {
  inspectionId: string;
  correctedAt: Date;
  previousVerdict: "OK" | "DEFECTIVE" | null;
  newVerdict: "OK" | "DEFECTIVE" | null;
  reason: string;
  actor: string;
};

export type ShiftReport = {
  company: string;
  timeZone: string;
  date: string;
  shift: { id: string; name: string; start: string; end: string; crossesMidnight: boolean };
  window: { from: Date; to: Date };
  generatedAt: Date;
  generatedBy: string;
  kpis: Kpis;
  bySource: SourceKpis[];
  defects: DefectRow[];
  defectsTruncated: boolean;
  corrections: CorrectionRow[];
};

const pad = (n: number) => String(n).padStart(2, "0");
/** "HH:MM" de una columna TIME (Prisma la entrega como fecha 1970-01-01 en UTC). */
export function timeOfDay(value: Date): string {
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}
const minutesOf = (value: Date) => value.getUTCHours() * 60 + value.getUTCMinutes();

/**
 * Inicio y fin del turno de ese día. Si termina antes (o a la misma hora) de lo
 * que empieza, cruza la medianoche y termina el día siguiente (HU31, criterio 2).
 */
export function shiftWindow(
  day: string,
  start: Date,
  end: Date,
  timeZone: string,
): { from: Date; to: Date; crossesMidnight: boolean } {
  const crossesMidnight = minutesOf(end) <= minutesOf(start);
  const startDay = startOfLocalDay(day, timeZone);
  const endDay = crossesMidnight ? startOfLocalDay(addDays(day, 1), timeZone) : startDay;
  return {
    from: new Date(startDay.getTime() + minutesOf(start) * 60_000),
    to: new Date(endDay.getTime() + minutesOf(end) * 60_000),
    crossesMidnight,
  };
}

export function kpisOf(ok: number, defective: number, corrected: number): Kpis {
  const inspected = ok + defective;
  return { inspected, ok, defective, defectRate: inspected === 0 ? 0 : defective / inspected, corrected };
}

export async function buildShiftReport(
  db: PrismaClient,
  actor: AuthzUser & { name?: string },
  query: ShiftReportQuery,
  now: Date = new Date(),
): Promise<ShiftReport> {
  await authorize(actor, "reportes:descargar", { empresaId: actor.empresaId, path: "buildShiftReport" });
  const parsed = shiftReportQuerySchema.safeParse(query);
  if (!parsed.success) throw new ReportError("INVALID", parsed.error.issues[0]?.message ?? "Datos inválidos");
  const companyId = actor.empresaId;
  if (!companyId) throw new ReportError("NOT_FOUND", "Tu cuenta no pertenece a ninguna empresa");

  const [company, shift] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { name: true, timezone: true } }),
    db.shift.findFirst({
      where: { id: parsed.data.turno, companyId },
      select: { id: true, name: true, startTime: true, endTime: true },
    }),
  ]);
  if (!company || !shift) throw new ReportError("NOT_FOUND", "El turno no existe en tu empresa");

  const timeZone = company.timezone;
  const window = shiftWindow(parsed.data.fecha, shift.startTime, shift.endTime, timeZone);
  const where = { companyId, shiftId: shift.id, capturedAt: { gte: window.from, lt: window.to } };

  const [byVerdict, correctedCount, bySourceRaw, defectsRaw, correctionsRaw, stations] = await Promise.all([
    db.inspection.groupBy({ by: ["currentVerdict"], where, _count: { _all: true } }),
    db.inspection.count({ where: { ...where, correctedAt: { not: null } } }),
    db.inspection.groupBy({
      by: ["stationId", "currentVerdict"],
      where,
      _count: { _all: true },
    }),
    db.inspection.findMany({
      where: { ...where, currentVerdict: "DEFECTIVE" },
      orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
      take: MAX_DEFECT_ROWS + 1,
      select: {
        id: true,
        capturedAt: true,
        confidence: true,
        predictedVerdict: true,
        correctedAt: true,
        imageKey: true,
        part: { select: { code: true } },
        mold: { select: { code: true } },
        batch: { select: { code: true } },
        inspector: { select: { name: true } },
        station: { select: { name: true } },
      },
    }),
    db.inspectionEvent.findMany({
      where: { companyId, type: "CORRECTED", inspection: where },
      orderBy: { createdAt: "asc" },
      select: {
        inspectionId: true,
        createdAt: true,
        previousVerdict: true,
        newVerdict: true,
        reason: true,
        actor: { select: { name: true } },
      },
    }),
    db.station.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);

  const count = (verdict: "OK" | "DEFECTIVE") => byVerdict.find((g) => g.currentVerdict === verdict)?._count._all ?? 0;
  const kpis = kpisOf(count("OK"), count("DEFECTIVE"), correctedCount);

  // Correcciones por origen: se cuentan por inspección corregida.
  const correctedBySource = await db.inspection.groupBy({
    by: ["stationId"],
    where: { ...where, correctedAt: { not: null } },
    _count: { _all: true },
  });
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const sources = new Map<string, { label: string; ok: number; defective: number; corrected: number }>();
  for (const g of bySourceRaw) {
    const key = g.stationId ?? "manual";
    const entry = sources.get(key) ?? {
      label: g.stationId ? (stationName.get(g.stationId) ?? "Estación") : "Inspección manual",
      ok: 0,
      defective: 0,
      corrected: 0,
    };
    if (g.currentVerdict === "OK") entry.ok += g._count._all;
    else entry.defective += g._count._all;
    sources.set(key, entry);
  }
  for (const g of correctedBySource) {
    const entry = sources.get(g.stationId ?? "manual");
    if (entry) entry.corrected = g._count._all;
  }
  const bySource = [...sources.values()]
    .map((s) => ({ label: s.label, ...kpisOf(s.ok, s.defective, s.corrected) }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

  return {
    company: company.name,
    timeZone,
    date: parsed.data.fecha,
    shift: {
      id: shift.id,
      name: shift.name,
      start: timeOfDay(shift.startTime),
      end: timeOfDay(shift.endTime),
      crossesMidnight: window.crossesMidnight,
    },
    window: { from: window.from, to: window.to },
    generatedAt: now,
    generatedBy: actor.name ?? "",
    kpis,
    bySource,
    defects: defectsRaw.slice(0, MAX_DEFECT_ROWS).map((d) => ({
      id: d.id,
      capturedAt: d.capturedAt,
      part: d.part.code,
      mold: d.mold.code,
      batch: d.batch.code,
      author: d.station?.name ?? d.inspector?.name ?? "—",
      confidence: Number(d.confidence),
      predictedVerdict: d.predictedVerdict,
      corrected: d.correctedAt !== null,
      imageKey: d.imageKey,
    })),
    defectsTruncated: defectsRaw.length > MAX_DEFECT_ROWS,
    corrections: correctionsRaw.map((c) => ({
      inspectionId: c.inspectionId,
      correctedAt: c.createdAt,
      previousVerdict: c.previousVerdict,
      newVerdict: c.newVerdict,
      reason: c.reason ?? "",
      actor: c.actor?.name ?? "—",
    })),
  };
}

/** Nombre de archivo seguro: reporte-turno-2026-11-08-manana.pdf */
export function reportFileName(report: Pick<ShiftReport, "date" | "shift">, extension: "pdf" | "xlsx"): string {
  const slug = report.shift.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `reporte-turno-${report.date}-${slug || "turno"}.${extension}`;
}
