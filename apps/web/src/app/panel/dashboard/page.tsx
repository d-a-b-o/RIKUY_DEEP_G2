import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DefectRateChart, MoldRanking, TrendChart } from "@/components/dashboard/charts";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { getDashboard, MAX_RANGE_DAYS, parseDashboardFilters, type Breakdown, type DashboardFilters } from "@/lib/dashboard/service";
import { getDb } from "@/lib/db";
import { getHistoryFilterOptions, type FilterOption } from "@/lib/inspections/history";
import type { Kpis } from "@/lib/reports/shift-report";

export const metadata: Metadata = {
  title: "Dashboard de calidad",
  robots: { index: false },
};

const PATH = "/panel/dashboard";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const nf = new Intl.NumberFormat("es-PE");
const pf = new Intl.NumberFormat("es-PE", { style: "percent", maximumFractionDigits: 1 });

/** HU37 · Dashboard de calidad por turno (RIKDP-48). */
export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Calidad</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Dashboard de calidad</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Indicadores por turno y por estación, tendencia diaria y moldes con más defectos.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Calculando indicadores…</p>}>
          <Dashboard searchParams={searchParams} />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(PATH, "dashboard:ver");
  if (!allowed) return <Forbidden />;
  const actor = toAuthzUser(user);
  const filters = parseDashboardFilters(await searchParams);
  const db = getDb();
  const [data, options] = await Promise.all([getDashboard(db, actor, filters), getHistoryFilterOptions(db, actor)]);
  const canReport = can(actor, "reportes:descargar", { empresaId: actor.empresaId });

  return (
    <div className="flex flex-col gap-8">
      <Filters filters={filters} range={data.range} options={options} />
      {data.range.clipped ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          El rango máximo es de {MAX_RANGE_DAYS} días: se muestran los últimos {MAX_RANGE_DAYS} hasta el {data.range.to}.
        </p>
      ) : null}

      <section aria-labelledby="kpi" className="flex flex-col gap-3">
        <h2 id="kpi" className="sr-only">
          Indicadores del período
        </h2>
        <KpiTiles kpis={data.kpis} />
        <p className="text-xs text-muted-foreground">
          Del {data.range.from} al {data.range.to} · hora de la planta ({data.timeZone}) · calculado en {data.elapsedMs} ms
        </p>
      </section>

      {data.kpis.inspected === 0 ? (
        <p className="ui-card p-6 text-muted-foreground">No hay inspecciones con estos filtros.</p>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <BreakdownTable id="por-turno" title="Por turno" rows={data.byShift} />
            <BreakdownTable id="por-estacion" title="Por estación" rows={data.byStation} />
          </div>

          <section aria-labelledby="tendencia" className="ui-card flex flex-col gap-4 p-5">
            <h2 id="tendencia" className="text-lg font-semibold">
              Tendencia diaria
            </h2>
            <TrendChart data={data.trend} />
            <h3 className="mt-2 font-semibold">% de defectos por día</h3>
            <DefectRateChart data={data.trend} />
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-primary">Ver como tabla</summary>
              <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Tendencia diaria en tabla">
                <table className="w-full min-w-[480px] text-left">
                  <caption className="sr-only">Inspecciones por día</caption>
                  <thead className="border-b border-border text-muted-foreground">
                    <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:whitespace-nowrap">
                      <th scope="col">Día</th>
                      <th scope="col">Inspeccionadas</th>
                      <th scope="col">Defectuosas</th>
                      <th scope="col">% defectos</th>
                      <th scope="col">Corregidas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((d) => (
                      <tr key={d.day} className="border-b border-border/60 last:border-0 [&_td]:px-3 [&_td]:py-1.5 [&_td]:tabular-nums">
                        <td>{d.day}</td>
                        <td>{nf.format(d.inspected)}</td>
                        <td>{nf.format(d.defective)}</td>
                        <td>{pf.format(d.defectRate)}</td>
                        <td>{nf.format(d.corrected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <section aria-labelledby="ranking" className="ui-card flex flex-col gap-4 p-5">
            <h2 id="ranking" className="text-lg font-semibold">
              Moldes con más defectuosas
            </h2>
            {data.moldRanking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún molde tiene piezas defectuosas en el período.</p>
            ) : (
              <MoldRanking data={data.moldRanking} />
            )}
          </section>
        </>
      )}

      {canReport ? (
        <p className="text-sm text-muted-foreground">
          ¿Necesitas el cierre de un turno en PDF o Excel?{" "}
          <Link href="/panel/reportes" className="font-medium text-primary hover:underline">
            Descarga el reporte de fin de turno
          </Link>
          . Usa los mismos cálculos que este dashboard.
        </p>
      ) : null}
    </div>
  );
}

function KpiTiles({ kpis }: { kpis: Kpis }) {
  const tiles: [string, string, string?][] = [
    ["Inspeccionadas", nf.format(kpis.inspected)],
    ["OK", nf.format(kpis.ok)],
    ["Defectuosas", nf.format(kpis.defective), "text-defect"],
    ["% de defectos", pf.format(kpis.defectRate)],
    ["Corregidas", nf.format(kpis.corrected)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map(([label, value, tone]) => (
        <div key={label} className="ui-card p-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BreakdownTable({ id, title, rows }: { id: string; title: string; rows: Breakdown[] }) {
  return (
    <section aria-labelledby={id} className="ui-card flex flex-col gap-3 p-5">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} (se desplaza de lado)`}>
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:whitespace-nowrap">
              <th scope="col">{title.replace("Por ", "").replace(/^./, (c) => c.toUpperCase())}</th>
              <th scope="col">Inspeccionadas</th>
              <th scope="col">Defectuosas</th>
              <th scope="col">% defectos</th>
              <th scope="col">Corregidas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? r.label} className="border-b border-border/60 last:border-0 [&_td]:px-3 [&_td]:py-2 [&_td]:tabular-nums">
                <td>{r.label}</td>
                <td>{nf.format(r.inspected)}</td>
                <td>{nf.format(r.defective)}</td>
                <td>{pf.format(r.defectRate)}</td>
                <td>{nf.format(r.corrected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: FilterOption[] }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="ui-input">
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Filters({
  filters,
  range,
  options,
}: {
  filters: DashboardFilters;
  range: { from: string; to: string };
  options: Awaited<ReturnType<typeof getHistoryFilterOptions>>;
}) {
  return (
    <form method="get" action={PATH} className="ui-card flex flex-col gap-4 p-5" aria-label="Filtros">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Desde</span>
          <input type="date" name="desde" defaultValue={range.from} className="ui-input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Hasta</span>
          <input type="date" name="hasta" defaultValue={range.to} className="ui-input" />
        </label>
        <Select name="turno" label="Turno" value={filters.turno} options={options.shifts} />
        {options.stations.length > 0 ? <Select name="estacion" label="Estación" value={filters.estacion} options={options.stations} /> : null}
        <Select name="pieza" label="Pieza" value={filters.pieza} options={options.parts} />
        <Select name="molde" label="Molde" value={filters.molde} options={options.molds} />
        <Select name="lote" label="Lote" value={filters.lote} options={options.batches} />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="ui-button">
          Aplicar filtros
        </button>
        <Link href={PATH} className="ui-button ui-button-secondary">
          Últimos 7 días
        </Link>
      </div>
    </form>
  );
}
