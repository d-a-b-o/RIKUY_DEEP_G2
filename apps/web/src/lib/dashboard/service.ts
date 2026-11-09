import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";
import { addDays, startOfLocalDay } from "@/lib/inspections/history";
import { kpisOf, type Kpis } from "@/lib/reports/shift-report";

/**
 * HU37 · Dashboard de calidad por turno (RIKDP-48, RIKDP-201/202/203).
 *
 * Una sola consulta con GROUPING SETS recorre las inspecciones del rango una
 * vez y devuelve a la vez el total y los cortes por turno, estación, molde y
 * día (criterio 4: < 2 s con 500.000 inspecciones). Usa el índice
 * (company_id, captured_at DESC). Los KPI salen de kpisOf, la misma función del
 * reporte de turno (HU38), así que los valores coinciden (criterio 3).
 */

export const MAX_RANGE_DAYS = 92;
export const DEFAULT_RANGE_DAYS = 7;
export const MOLD_RANKING_SIZE = 10;

const uuid = z.uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && uuid.safeParse(v).success ? v : undefined));
const day = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined));

export const dashboardFiltersSchema = z.object({
  desde: day,
  hasta: day,
  turno: optionalUuid,
  estacion: optionalUuid,
  pieza: optionalUuid,
  molde: optionalUuid,
  lote: optionalUuid,
});
export type DashboardFilters = z.output<typeof dashboardFiltersSchema>;

export function parseDashboardFilters(params: Record<string, string | string[] | undefined>): DashboardFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return dashboardFiltersSchema.parse(flat);
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Rango efectivo: por defecto los últimos 7 días hasta hoy, ordenado y como máximo 92 días. */
export function resolveRange(filters: DashboardFilters, today: string): { from: string; to: string; clipped: boolean } {
  let to = filters.hasta ?? today;
  let from = filters.desde ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (dayDiff(from, to) < 0) [from, to] = [to, from];
  const clipped = dayDiff(from, to) >= MAX_RANGE_DAYS;
  if (clipped) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to, clipped };
}

export type Breakdown = Kpis & { id: string | null; label: string };
export type DayPoint = Kpis & { day: string };

export type Dashboard = {
  timeZone: string;
  range: { from: string; to: string; clipped: boolean };
  kpis: Kpis;
  byShift: Breakdown[];
  byStation: Breakdown[];
  trend: DayPoint[];
  moldRanking: Breakdown[];
  elapsedMs: number;
};

type Row = {
  g: number;
  shift_id: string | null;
  station_id: string | null;
  mold_id: string | null;
  day: string | null;
  ok: bigint;
  defective: bigint;
  corrected: bigint;
};

// GROUPING(shift_id, station_id, mold_id, day): bit en 1 = columna fuera del conjunto.
const G_SHIFT = 0b0111;
const G_STATION = 0b1011;
const G_MOLD = 0b1101;
const G_DAY = 0b1110;
const G_TOTAL = 0b1111;

export async function getDashboard(
  db: PrismaClient,
  actor: AuthzUser,
  filters: DashboardFilters,
  now: Date = new Date(),
): Promise<Dashboard> {
  await authorize(actor, "dashboard:ver", { empresaId: actor.empresaId, path: "getDashboard" });
  const companyId = actor.empresaId;
  if (!companyId) throw new Error("La cuenta no pertenece a ninguna empresa");
  const started = performance.now();

  const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  const timeZone = company?.timezone ?? "America/Lima";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const range = resolveRange(filters, today);
  const from = startOfLocalDay(range.from, timeZone);
  const to = startOfLocalDay(addDays(range.to, 1), timeZone);

  const conditions = [
    Prisma.sql`company_id = ${companyId}`,
    Prisma.sql`captured_at >= ${from}`,
    Prisma.sql`captured_at < ${to}`,
  ];
  if (filters.turno) conditions.push(Prisma.sql`shift_id = ${filters.turno}`);
  if (filters.estacion) conditions.push(Prisma.sql`station_id = ${filters.estacion}`);
  if (filters.pieza) conditions.push(Prisma.sql`part_id = ${filters.pieza}`);
  if (filters.molde) conditions.push(Prisma.sql`mold_id = ${filters.molde}`);
  if (filters.lote) conditions.push(Prisma.sql`batch_id = ${filters.lote}`);

  const rows = await db.$queryRaw<Row[]>`
    SELECT
      GROUPING(shift_id, station_id, mold_id, day)::int AS g,
      shift_id, station_id, mold_id, day::text AS day,
      count(*) FILTER (WHERE current_verdict = 'OK') AS ok,
      count(*) FILTER (WHERE current_verdict = 'DEFECTIVE') AS defective,
      count(*) FILTER (WHERE corrected_at IS NOT NULL) AS corrected
    FROM (
      SELECT shift_id, station_id, mold_id, current_verdict, corrected_at,
             (captured_at AT TIME ZONE ${timeZone})::date AS day
      FROM inspection
      WHERE ${Prisma.join(conditions, " AND ")}
    ) AS f
    GROUP BY GROUPING SETS ((shift_id), (station_id), (mold_id), (day), ())
  `;

  const of = (g: number) => rows.filter((r) => r.g === g);
  const k = (r: Row) => kpisOf(Number(r.ok), Number(r.defective), Number(r.corrected));

  const [shifts, stations, molds] = await Promise.all([
    db.shift.findMany({ where: { companyId }, select: { id: true, name: true, startTime: true } }),
    db.station.findMany({ where: { companyId }, select: { id: true, name: true } }),
    db.mold.findMany({ where: { companyId }, select: { id: true, code: true, part: { select: { code: true } } } }),
  ]);
  const shiftName = new Map(shifts.map((s) => [s.id, s.name]));
  const shiftOrder = new Map(shifts.map((s) => [s.id, s.startTime.getTime()]));
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const moldName = new Map(molds.map((m) => [m.id, `${m.code} · ${m.part.code}`]));

  const total = of(G_TOTAL)[0];
  const byDay = new Map(of(G_DAY).map((r) => [r.day!, k(r)]));
  const trend: DayPoint[] = [];
  for (let d = range.from; dayDiff(d, range.to) >= 0; d = addDays(d, 1)) {
    trend.push({ day: d, ...(byDay.get(d) ?? kpisOf(0, 0, 0)) });
  }

  return {
    timeZone,
    range,
    kpis: total ? k(total) : kpisOf(0, 0, 0),
    byShift: of(G_SHIFT)
      .map((r) => ({ id: r.shift_id, label: shiftName.get(r.shift_id!) ?? "Turno", ...k(r) }))
      .sort((a, b) => (shiftOrder.get(a.id!) ?? 0) - (shiftOrder.get(b.id!) ?? 0)),
    byStation: of(G_STATION)
      .map((r) => ({
        id: r.station_id,
        label: r.station_id ? (stationName.get(r.station_id) ?? "Estación") : "Inspección manual",
        ...k(r),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es")),
    trend,
    moldRanking: of(G_MOLD)
      .map((r) => ({ id: r.mold_id, label: moldName.get(r.mold_id!) ?? "Molde", ...k(r) }))
      .filter((m) => m.defective > 0)
      .sort((a, b) => b.defective - a.defective || b.defectRate - a.defectRate)
      .slice(0, MOLD_RANKING_SIZE),
    elapsedMs: Math.round(performance.now() - started),
  };
}
