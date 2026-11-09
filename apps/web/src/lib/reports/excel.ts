import type { ShiftReport } from "./shift-report";
import { buildXlsx, type Cell, type Sheet } from "./xlsx";

/** HU38-T02 (RIKDP-207): el reporte del turno como libro de Excel. */

const VERDICT = { OK: "OK", DEFECTIVE: "Defectuosa" } as const;
const pct = (value: number): Cell => ({ value, format: "percent" });

function dateTime(timeZone: string) {
  const f = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "medium", timeZone });
  return (d: Date) => f.format(d);
}

export function shiftReportSheets(report: ShiftReport): Sheet[] {
  const fmt = dateTime(report.timeZone);
  const { kpis } = report;

  const summary: Sheet = {
    name: "Resumen",
    widths: [28, 22, 14, 14, 14, 14],
    rows: [
      ["Reporte de fin de turno", ""],
      ["Empresa", report.company],
      ["Fecha", report.date],
      ["Turno", `${report.shift.name} (${report.shift.start}–${report.shift.end}${report.shift.crossesMidnight ? ", cruza medianoche" : ""})`],
      ["Desde", fmt(report.window.from)],
      ["Hasta", fmt(report.window.to)],
      ["Generado", `${fmt(report.generatedAt)}${report.generatedBy ? ` por ${report.generatedBy}` : ""}`],
      [],
      ["Inspeccionadas", kpis.inspected],
      ["OK", kpis.ok],
      ["Defectuosas", kpis.defective],
      ["% de defectos", pct(kpis.defectRate)],
      ["Corregidas", kpis.corrected],
      [],
      ["Por origen", "Inspeccionadas", "OK", "Defectuosas", "% defectos", "Corregidas"],
      ...report.bySource.map((s): Cell[] => [s.label, s.inspected, s.ok, s.defective, pct(s.defectRate), s.corrected]),
    ],
  };

  const defects: Sheet = {
    name: "Defectuosas",
    widths: [20, 12, 12, 16, 22, 12, 16, 12, 40],
    rows: [
      ["Fecha", "Pieza", "Molde", "Lote", "Registrada por", "Confianza", "Veredicto del modelo", "Corregida", "Id de inspección"],
      ...report.defects.map((d): Cell[] => [
        fmt(d.capturedAt),
        d.part,
        d.mold,
        d.batch,
        d.author,
        pct(d.confidence),
        VERDICT[d.predictedVerdict],
        d.corrected ? "Sí" : "No",
        d.id,
      ]),
      ...(report.defectsTruncated ? [[`Se listan las primeras ${report.defects.length}; el resumen cuenta todas.`]] : []),
    ],
  };

  const corrections: Sheet = {
    name: "Correcciones",
    widths: [20, 14, 14, 50, 22, 40],
    rows: [
      ["Fecha", "Antes", "Después", "Motivo", "Corregida por", "Id de inspección"],
      ...report.corrections.map((c): Cell[] => [
        fmt(c.correctedAt),
        c.previousVerdict ? VERDICT[c.previousVerdict] : "",
        c.newVerdict ? VERDICT[c.newVerdict] : "",
        c.reason,
        c.actor,
        c.inspectionId,
      ]),
    ],
  };

  return [summary, defects, corrections];
}

export function shiftReportXlsx(report: ShiftReport): Uint8Array {
  return buildXlsx(shiftReportSheets(report));
}
