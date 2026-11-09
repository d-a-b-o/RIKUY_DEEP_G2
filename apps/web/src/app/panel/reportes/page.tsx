import type { Metadata } from "next";
import { Suspense } from "react";
import { percent } from "@/components/inspection/labels";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { buildShiftReport, ReportError, shiftReportQuerySchema, timeOfDay, type ShiftReport } from "@/lib/reports/shift-report";

export const metadata: Metadata = {
  title: "Reporte de turno",
  robots: { index: false },
};

const PATH = "/panel/reportes";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** HU38 · Reporte de fin de turno (RIKDP-49): vista previa y descarga en PDF o Excel. */
export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Calidad</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Reporte de fin de turno</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Elige el día y el turno para ver el resumen y descargarlo en PDF (con miniaturas de las piezas defectuosas)
          o en Excel. Los dos archivos tienen los mismos valores.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
          <Reports searchParams={searchParams} />
        </Suspense>
      </div>
    </PanelShell>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Reports({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(PATH, "reportes:descargar");
  if (!allowed) return <Forbidden />;
  const actor = toAuthzUser(user);
  const db = getDb();
  const params = await searchParams;

  const [company, shifts] = await Promise.all([
    db.company.findUnique({ where: { id: actor.empresaId ?? "" }, select: { timezone: true } }),
    db.shift.findMany({
      where: { companyId: actor.empresaId ?? "", active: true },
      orderBy: { startTime: "asc" },
      select: { id: true, name: true, startTime: true, endTime: true },
    }),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: company?.timezone ?? "America/Lima" }).format(new Date());
  const query = { fecha: first(params.fecha) ?? today, turno: first(params.turno) ?? "" };

  let report: ShiftReport | null = null;
  let error: string | null = null;
  if (shiftReportQuerySchema.safeParse(query).success) {
    try {
      report = await buildShiftReport(db, { ...actor, name: user.name }, query);
    } catch (e) {
      if (!(e instanceof ReportError)) throw e;
      error = e.message;
    }
  }

  if (shifts.length === 0) {
    return (
      <p className="ui-card p-6 text-muted-foreground">
        Tu planta todavía no tiene turnos registrados. El administrador de planta puede crearlos en los catálogos.
      </p>
    );
  }

  const download = (formato: "pdf" | "xlsx") =>
    `${PATH}/turno?${new URLSearchParams({ fecha: query.fecha, turno: query.turno, formato })}`;

  return (
    <div className="flex flex-col gap-6">
      <form method="get" action={PATH} className="ui-card flex flex-col gap-4 p-5 sm:flex-row sm:items-end" aria-label="Elegir turno">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Día</span>
          <input type="date" name="fecha" required defaultValue={query.fecha} max={today} className="ui-input" />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Turno</span>
          <select name="turno" required defaultValue={query.turno} className="ui-input">
            <option value="" disabled>
              Elige un turno
            </option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({timeOfDay(s.startTime)}–{timeOfDay(s.endTime)})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ui-button">
          Ver resumen
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      {report ? (
        <section aria-labelledby="resumen" className="ui-card flex flex-col gap-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="resumen" className="text-lg font-semibold">
              {report.shift.name} · {report.date}
              {report.shift.crossesMidnight ? <span className="ml-2 text-sm font-normal text-muted-foreground">(cruza la medianoche)</span> : null}
            </h2>
            <div className="flex flex-wrap gap-3">
              <a href={download("pdf")} className="ui-button" download>
                Descargar PDF
              </a>
              <a href={download("xlsx")} className="ui-button ui-button-secondary" download>
                Descargar Excel
              </a>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5 [&_dd]:mt-1 [&_dd]:text-2xl [&_dd]:font-semibold [&_dt]:text-sm [&_dt]:text-muted-foreground">
            <div>
              <dt>Inspeccionadas</dt>
              <dd>{report.kpis.inspected}</dd>
            </div>
            <div>
              <dt>OK</dt>
              <dd>{report.kpis.ok}</dd>
            </div>
            <div>
              <dt>Defectuosas</dt>
              <dd className="text-defect">{report.kpis.defective}</dd>
            </div>
            <div>
              <dt>% de defectos</dt>
              <dd>{percent(report.kpis.defectRate)}</dd>
            </div>
            <div>
              <dt>Corregidas</dt>
              <dd>{report.kpis.corrected}</dd>
            </div>
          </dl>
          {report.bySource.length > 0 ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Indicadores por origen (se desplaza de lado)">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="sr-only">Indicadores por origen</caption>
                <thead className="border-b border-border text-muted-foreground">
                  <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                    <th scope="col">Origen</th>
                    <th scope="col">Inspeccionadas</th>
                    <th scope="col">Defectuosas</th>
                    <th scope="col">% defectos</th>
                    <th scope="col">Corregidas</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bySource.map((s) => (
                    <tr key={s.label} className="border-b border-border/60 last:border-0 [&_td]:px-3 [&_td]:py-2">
                      <td>{s.label}</td>
                      <td className="tabular-nums">{s.inspected}</td>
                      <td className="tabular-nums">{s.defective}</td>
                      <td className="tabular-nums">{percent(s.defectRate)}</td>
                      <td className="tabular-nums">{s.corrected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hubo inspecciones en este turno.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
