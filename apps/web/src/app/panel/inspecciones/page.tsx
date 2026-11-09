import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SOURCE_LABELS, VERDICT_LABELS, percent, verdictClass } from "@/components/inspection/labels";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  getHistoryFilterOptions,
  listInspections,
  parseHistoryFilters,
  type FilterOption,
  type HistoryFilters,
} from "@/lib/inspections/history";

export const metadata: Metadata = {
  title: "Historial de inspecciones",
  robots: { index: false },
};

const PATH = "/panel/inspecciones";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** HU42 · Historial paginado con filtros combinables (RIKDP-53, RIKDP-219). */
export default function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Trazabilidad</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Historial de inspecciones</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Todas las inspecciones de tu planta, de la más reciente a la más antigua. Combina los filtros y abre una
          inspección para ver su foto, su trazabilidad y corregir el veredicto.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando el historial…</p>}>
          <History searchParams={searchParams} />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function History({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(PATH, "inspecciones:ver");
  if (!allowed) return <Forbidden />;
  const actor = toAuthzUser(user);
  const filters = parseHistoryFilters(await searchParams);
  const db = getDb();
  const [page, options] = await Promise.all([listInspections(db, actor, filters), getHistoryFilterOptions(db, actor)]);

  const dateTime = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: page.timeZone });
  const nextHref = page.nextCursor ? hrefWith(filters, { cursor: page.nextCursor }) : null;

  return (
    <div className="flex flex-col gap-6">
      <FilterForm filters={filters} options={options} />

      {page.rows.length === 0 ? (
        <p className="ui-card p-6 text-muted-foreground">No hay inspecciones con estos filtros.</p>
      ) : (
        <div className="ui-card overflow-x-auto" tabIndex={0} role="region" aria-label="Inspecciones (se desplaza de lado)">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Inspecciones</caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr className="[&_th]:px-4 [&_th]:py-3 [&_th]:font-medium">
                <th scope="col">Fecha</th>
                <th scope="col">Veredicto</th>
                <th scope="col">Confianza</th>
                <th scope="col">Pieza · molde</th>
                <th scope="col">Lote · turno</th>
                <th scope="col">Origen</th>
                <th scope="col">
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0 [&_td]:px-4 [&_td]:py-3">
                  <td className="whitespace-nowrap tabular-nums">{dateTime.format(row.capturedAt)}</td>
                  <td>
                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${verdictClass(row.currentVerdict)}`}>
                      {VERDICT_LABELS[row.currentVerdict]}
                    </span>
                    {row.corrected ? <span className="ml-2 text-xs text-muted-foreground">corregida</span> : null}
                  </td>
                  <td className="tabular-nums">{percent(row.confidence)}</td>
                  <td>
                    {row.part} · {row.mold}
                  </td>
                  <td>
                    {row.batch} · {row.shift}
                  </td>
                  <td>
                    {SOURCE_LABELS[row.source]}
                    <span className="block text-xs text-muted-foreground">{row.author}</span>
                  </td>
                  <td>
                    <Link href={`${PATH}/${row.id}`} className="font-medium text-primary hover:underline">
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Paginación" className="flex flex-wrap gap-3">
        {filters.cursor ? (
          <Link href={hrefWith(filters, { cursor: undefined })} className="ui-button ui-button-secondary">
            Más recientes
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className="ui-button ui-button-secondary">
            Más antiguas
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

function hrefWith(filters: HistoryFilters, change: Partial<HistoryFilters>): string {
  const merged = { ...filters, ...change };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === false || value === "") continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const query = params.toString();
  return query ? `${PATH}?${query}` : PATH;
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: readonly FilterOption[];
}) {
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

function FilterForm({
  filters,
  options,
}: {
  filters: HistoryFilters;
  options: Awaited<ReturnType<typeof getHistoryFilterOptions>>;
}) {
  const verdicts = Object.entries(VERDICT_LABELS).map(([id, label]) => ({ id, label }));
  const sources = Object.entries(SOURCE_LABELS).map(([id, label]) => ({ id, label }));
  return (
    <form method="get" action={PATH} className="ui-card flex flex-col gap-4 p-5" aria-label="Filtros">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Desde</span>
          <input type="date" name="desde" defaultValue={filters.desde} className="ui-input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Hasta</span>
          <input type="date" name="hasta" defaultValue={filters.hasta} className="ui-input" />
        </label>
        <Select name="veredicto" label="Veredicto" value={filters.veredicto} options={verdicts} />
        <Select name="origen" label="Origen" value={filters.origen} options={sources} />
        <Select name="turno" label="Turno" value={filters.turno} options={options.shifts} />
        <Select name="lote" label="Lote" value={filters.lote} options={options.batches} />
        <Select name="pieza" label="Pieza" value={filters.pieza} options={options.parts} />
        <Select name="molde" label="Molde" value={filters.molde} options={options.molds} />
        {options.stations.length > 0 ? (
          <Select name="estacion" label="Estación" value={filters.estacion} options={options.stations} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="corregidas" value="1" defaultChecked={filters.corregidas} />
          Solo corregidas
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="reentrenamiento" value="1" defaultChecked={filters.reentrenamiento} />
          Solo marcadas para reentrenamiento
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="ui-button">
          Filtrar
        </button>
        <Link href={PATH} className="ui-button ui-button-secondary">
          Limpiar
        </Link>
      </div>
    </form>
  );
}
