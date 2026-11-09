import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";

/**
 * HU42 · Consultar el historial de inspecciones (RIKDP-53, RIKDP-219).
 *
 * Tabla paginada con filtros combinables, siempre dentro de la empresa del
 * usuario. La paginación es por cursor (fecha de captura + id) y no por número
 * de página: con cientos de miles de inspecciones, OFFSET se vuelve lento y el
 * índice (company_id, captured_at DESC) ya sirve este orden.
 */

export const HISTORY_PAGE_SIZE = 25;

const uuid = z.uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && uuid.safeParse(v).success ? v : undefined));
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined));
const flag = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true" || v === "on");

/** Filtros tal como llegan en la URL (?veredicto=DEFECTIVE&desde=2026-11-01…). Lo inválido se ignora. */
export const historyFiltersSchema = z.object({
  desde: optionalDate,
  hasta: optionalDate,
  veredicto: z
    .string()
    .optional()
    .transform((v) => (v === "OK" || v === "DEFECTIVE" ? v : undefined)),
  origen: z
    .string()
    .optional()
    .transform((v) => (v === "LINE" || v === "CAMERA" || v === "BATCH" || v === "UPLOAD" ? v : undefined)),
  turno: optionalUuid,
  lote: optionalUuid,
  molde: optionalUuid,
  pieza: optionalUuid,
  estacion: optionalUuid,
  corregidas: flag,
  reentrenamiento: flag,
  cursor: z.string().max(200).optional(),
});

export type HistoryFilters = z.output<typeof historyFiltersSchema>;

/** Convierte los searchParams de la página (string | string[]) en filtros válidos. */
export function parseHistoryFilters(params: Record<string, string | string[] | undefined>): HistoryFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  return historyFiltersSchema.parse(flat);
}

// ─── Cursor ─────────────────────────────────────────────────────────────────

type Cursor = { capturedAt: Date; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.capturedAt.toISOString()}|${cursor.id}`).toString("base64url");
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  const [iso, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const capturedAt = new Date(iso ?? "");
  if (Number.isNaN(capturedAt.getTime()) || !uuid.safeParse(id).success) return null;
  return { capturedAt, id: id! };
}

// ─── Fechas en la zona horaria de la planta ────────────────────────────────

/** Minutos que la zona horaria va por delante de UTC en ese instante (Lima: −300). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Instante UTC de la medianoche local del día `yyyy-mm-dd` en `timeZone`. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60_000);
  // Segunda pasada por si el desfase cambia ese día (horario de verano).
  return new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60_000);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Consulta ───────────────────────────────────────────────────────────────

/** Condición WHERE de los filtros. Exportada para reutilizarla en el reporte del turno (HU38). */
export function historyWhere(companyId: string, filters: HistoryFilters, timeZone: string): Prisma.InspectionWhereInput {
  const where: Prisma.InspectionWhereInput = { companyId };
  const captured: Prisma.DateTimeFilter = {};
  if (filters.desde) captured.gte = startOfLocalDay(filters.desde, timeZone);
  if (filters.hasta) captured.lt = startOfLocalDay(addDays(filters.hasta, 1), timeZone);
  if (captured.gte || captured.lt) where.capturedAt = captured;
  if (filters.veredicto) where.currentVerdict = filters.veredicto;
  if (filters.origen) where.source = filters.origen;
  if (filters.turno) where.shiftId = filters.turno;
  if (filters.lote) where.batchId = filters.lote;
  if (filters.molde) where.moldId = filters.molde;
  if (filters.pieza) where.partId = filters.pieza;
  if (filters.estacion) where.stationId = filters.estacion;
  if (filters.corregidas) where.correctedAt = { not: null };
  if (filters.reentrenamiento) where.events = { some: { type: "FLAGGED_FOR_RETRAINING" } };
  return where;
}

export type HistoryRow = {
  id: string;
  capturedAt: Date;
  source: "LINE" | "CAMERA" | "BATCH" | "UPLOAD";
  predictedVerdict: "OK" | "DEFECTIVE";
  currentVerdict: "OK" | "DEFECTIVE";
  corrected: boolean;
  confidence: number;
  hasImage: boolean;
  part: string;
  mold: string;
  batch: string;
  shift: string;
  author: string;
};

export type HistoryPage = { rows: HistoryRow[]; nextCursor: string | null; timeZone: string };

export async function listInspections(
  db: PrismaClient,
  actor: AuthzUser,
  filters: HistoryFilters,
  pageSize = HISTORY_PAGE_SIZE,
): Promise<HistoryPage> {
  await authorize(actor, "inspecciones:ver", { empresaId: actor.empresaId, path: "listInspections" });
  const companyId = actor.empresaId;
  if (!companyId) return { rows: [], nextCursor: null, timeZone: "America/Lima" };

  const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  const timeZone = company?.timezone ?? "America/Lima";
  const where = historyWhere(companyId, filters, timeZone);

  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    where.AND = [
      {
        OR: [
          { capturedAt: { lt: cursor.capturedAt } },
          { capturedAt: cursor.capturedAt, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const size = Math.min(Math.max(pageSize, 1), 100);
  const found = await db.inspection.findMany({
    where,
    orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    take: size + 1,
    select: {
      id: true,
      capturedAt: true,
      source: true,
      predictedVerdict: true,
      currentVerdict: true,
      correctedAt: true,
      confidence: true,
      imageKey: true,
      part: { select: { code: true } },
      mold: { select: { code: true } },
      batch: { select: { code: true } },
      shift: { select: { name: true } },
      inspector: { select: { name: true } },
      station: { select: { name: true } },
    },
  });

  const page = found.slice(0, size);
  const last = page.at(-1);
  return {
    timeZone,
    nextCursor: found.length > size && last ? encodeCursor(last) : null,
    rows: page.map((r) => ({
      id: r.id,
      capturedAt: r.capturedAt,
      source: r.source,
      predictedVerdict: r.predictedVerdict,
      currentVerdict: r.currentVerdict,
      corrected: r.correctedAt !== null,
      confidence: Number(r.confidence),
      hasImage: r.imageKey !== null,
      part: r.part.code,
      mold: r.mold.code,
      batch: r.batch.code,
      shift: r.shift.name,
      author: r.station?.name ?? r.inspector?.name ?? "—",
    })),
  };
}

export type FilterOption = { id: string; label: string };
export type HistoryFilterOptions = {
  shifts: FilterOption[];
  batches: FilterOption[];
  molds: FilterOption[];
  parts: FilterOption[];
  stations: FilterOption[];
};

/** Opciones de los selectores de filtro: solo los catálogos de la propia empresa. */
export async function getHistoryFilterOptions(db: PrismaClient, actor: AuthzUser): Promise<HistoryFilterOptions> {
  await authorize(actor, "inspecciones:ver", { empresaId: actor.empresaId, path: "getHistoryFilterOptions" });
  const companyId = actor.empresaId;
  if (!companyId) return { shifts: [], batches: [], molds: [], parts: [], stations: [] };

  const [shifts, batches, molds, parts, stations] = await Promise.all([
    db.shift.findMany({ where: { companyId }, orderBy: { startTime: "asc" }, select: { id: true, name: true } }),
    db.batch.findMany({ where: { companyId }, orderBy: { openedAt: "desc" }, take: 200, select: { id: true, code: true } }),
    db.mold.findMany({ where: { companyId }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    db.part.findMany({ where: { companyId }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.station.findMany({ where: { companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    shifts: shifts.map((s) => ({ id: s.id, label: s.name })),
    batches: batches.map((b) => ({ id: b.id, label: b.code })),
    molds: molds.map((m) => ({ id: m.id, label: m.code })),
    parts: parts.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` })),
    stations: stations.map((s) => ({ id: s.id, label: s.name })),
  };
}
