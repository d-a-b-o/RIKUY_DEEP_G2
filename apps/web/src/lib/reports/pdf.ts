import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { DefectRow, ShiftReport } from "./shift-report";

/**
 * HU38-T01 (RIKDP-206): el reporte del turno en PDF (A4), con resumen, KPI por
 * origen, detalle de defectuosas con miniatura y correcciones.
 */

/** Descarga la foto de una inspección. Devuelve null si no hay o no se pudo. */
export type ImageLoader = (imageKey: string) => Promise<Uint8Array | null>;

/** Miniaturas como máximo; el resto de defectuosas se lista sin foto. */
export const MAX_THUMBNAILS = 60;

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const DEFECT = rgb(0.72, 0.16, 0.16);
const RULE = rgb(0.85, 0.87, 0.9);

// Helvetica estándar usa WinAnsi: cubre el español, pero no flechas ni emojis.
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function pdfSafe(text: string): string {
  return [...text.replace(/→/g, "->")]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code === 9 || code === 10) return " ";
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
      return "?";
    })
    .join("");
}

const VERDICT = { OK: "OK", DEFECTIVE: "Defectuosa" } as const;
const percent = (v: number) => `${(v * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size + 4);
    this.page.drawText(pdfSafe(value), {
      x: opts.x ?? MARGIN,
      y: this.y - size,
      size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
    this.y -= size + 4;
  }

  /** Texto con saltos de línea automáticos dentro de `width`. */
  wrapped(value: string, width: number, x: number, size = 9, color = INK) {
    const words = pdfSafe(value).split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (this.font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    for (const l of lines) {
      this.page.drawText(l, { x, y: this.y - size, size, font: this.font, color });
      this.y -= size + 3;
    }
    return lines.length;
  }

  rule() {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.width - MARGIN, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 8;
  }

  gap(h = 8) {
    this.y -= h;
  }

  /** Fila de tabla con columnas de ancho fijo. */
  row(cells: string[], widths: number[], opts: { bold?: boolean; size?: number } = {}) {
    const size = opts.size ?? 9;
    this.ensure(size + 6);
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const font = opts.bold ? this.bold : this.font;
      let value = pdfSafe(cell);
      while (value.length > 1 && font.widthOfTextAtSize(value, size) > widths[i]! - 4) value = value.slice(0, -2) + "…";
      this.page.drawText(value, { x, y: this.y - size, size, font, color: INK });
      x += widths[i]!;
    });
    this.y -= size + 6;
  }

  finish() {
    const pages = this.doc.getPages();
    pages.forEach((page, i) => {
      page.drawText(pdfSafe(`${this.footer} · Página ${i + 1} de ${pages.length}`), {
        x: MARGIN,
        y: MARGIN - 16,
        size: 8,
        font: this.font,
        color: MUTED,
      });
    });
  }
}

async function embed(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
  } catch {
    // Imagen dañada o en otro formato (p. ej. WebP): se lista sin miniatura.
  }
  return null;
}

/** Descarga las miniaturas de a pocas a la vez. */
async function loadThumbnails(doc: PDFDocument, defects: DefectRow[], load?: ImageLoader) {
  const result = new Map<string, PDFImage>();
  if (!load) return result;
  const pending = defects.filter((d) => d.imageKey).slice(0, MAX_THUMBNAILS);
  const CONCURRENCY = 6;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + CONCURRENCY).map(async (d) => {
        const bytes = await load(d.imageKey!).catch(() => null);
        const image = bytes ? await embed(doc, bytes) : null;
        if (image) result.set(d.id, image);
      }),
    );
  }
  return result;
}

export async function shiftReportPdf(report: ShiftReport, loadImage?: ImageLoader): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Reporte de turno ${report.shift.name} ${report.date}`));
  doc.setAuthor("RikuyDeep");
  doc.setCreationDate(report.generatedAt);
  const [font, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const fmt = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: report.timeZone });
  const w = new Writer(doc, font, bold, `RikuyDeep · ${report.company} · Turno ${report.shift.name} del ${report.date}`);

  // Encabezado
  w.text("Reporte de fin de turno", { size: 18, bold: true });
  w.text(`${report.company} · ${report.shift.name} (${report.shift.start}–${report.shift.end}) · ${report.date}`, {
    size: 11,
    color: MUTED,
  });
  w.text(
    `Del ${fmt.format(report.window.from)} al ${fmt.format(report.window.to)} · generado el ${fmt.format(report.generatedAt)}${report.generatedBy ? ` por ${report.generatedBy}` : ""}`,
    { size: 9, color: MUTED },
  );
  w.gap();
  w.rule();

  // KPI
  const k = report.kpis;
  const tiles: [string, string][] = [
    ["Inspeccionadas", String(k.inspected)],
    ["OK", String(k.ok)],
    ["Defectuosas", String(k.defective)],
    ["% de defectos", percent(k.defectRate)],
    ["Corregidas", String(k.corrected)],
  ];
  const tileW = (A4.width - MARGIN * 2) / tiles.length;
  w.ensure(44);
  tiles.forEach(([label, value], i) => {
    const x = MARGIN + i * tileW;
    w.page.drawText(pdfSafe(label), { x, y: w.y - 9, size: 9, font, color: MUTED });
    w.page.drawText(pdfSafe(value), { x, y: w.y - 32, size: 20, font: bold, color: label === "Defectuosas" ? DEFECT : INK });
  });
  w.y -= 44;
  w.rule();

  // Por origen
  w.text("Por estación u origen", { size: 12, bold: true });
  const srcW = [160, 85, 60, 70, 70, 70];
  w.row(["Origen", "Inspeccionadas", "OK", "Defectuosas", "% defectos", "Corregidas"], srcW, { bold: true });
  if (report.bySource.length === 0) w.text("Sin inspecciones en este turno.", { size: 9, color: MUTED });
  for (const s of report.bySource) {
    w.row([s.label, String(s.inspected), String(s.ok), String(s.defective), percent(s.defectRate), String(s.corrected)], srcW);
  }
  w.gap();
  w.rule();

  // Defectuosas con miniatura
  w.text(`Piezas defectuosas (${k.defective})`, { size: 12, bold: true });
  if (report.defects.length === 0) w.text("Ninguna pieza defectuosa en este turno.", { size: 9, color: MUTED });
  const thumbs = await loadThumbnails(doc, report.defects, loadImage);
  const THUMB = 64;
  for (const d of report.defects) {
    const image = thumbs.get(d.id);
    const height = image ? THUMB + 8 : 30;
    w.ensure(height);
    const top = w.y;
    const textX = MARGIN + (image ? THUMB + 12 : 0);
    if (image) {
      const scale = Math.min(THUMB / image.width, THUMB / image.height);
      w.page.drawImage(image, { x: MARGIN, y: top - image.height * scale, width: image.width * scale, height: image.height * scale });
    }
    w.page.drawText(pdfSafe(`${fmt.format(d.capturedAt)} · ${d.part} · molde ${d.mold} · lote ${d.batch}`), {
      x: textX,
      y: top - 10,
      size: 9.5,
      font: bold,
      color: INK,
    });
    const detail = `${d.author} · confianza ${percent(d.confidence)} · modelo: ${VERDICT[d.predictedVerdict]}${d.corrected ? " · corregida" : ""}`;
    w.page.drawText(pdfSafe(detail), { x: textX, y: top - 23, size: 8.5, font, color: MUTED });
    w.y = top - height;
  }
  if (report.defectsTruncated) w.text(`Se listan las primeras ${report.defects.length}.`, { size: 9, color: MUTED });
  if (report.defects.filter((d) => d.imageKey).length > MAX_THUMBNAILS) {
    w.text(`Miniaturas de las primeras ${MAX_THUMBNAILS}; el resto se lista sin foto.`, { size: 9, color: MUTED });
  }
  w.gap();
  w.rule();

  // Correcciones
  w.text(`Correcciones (${report.corrections.length})`, { size: 12, bold: true });
  if (report.corrections.length === 0) w.text("No se corrigió ningún veredicto de este turno.", { size: 9, color: MUTED });
  for (const c of report.corrections) {
    w.ensure(34);
    const change = `${c.previousVerdict ? VERDICT[c.previousVerdict] : "?"} -> ${c.newVerdict ? VERDICT[c.newVerdict] : "?"}`;
    w.text(`${fmt.format(c.correctedAt)} · ${change} · ${c.actor}`, { size: 9.5, bold: true });
    w.wrapped(`Motivo: ${c.reason}`, A4.width - MARGIN * 2, MARGIN, 9, MUTED);
    w.gap(4);
  }

  w.finish();
  return doc.save();
}
