import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogForm } from "@/components/catalogs/catalog-form";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { listCatalogs, type Catalogs } from "@/lib/catalogs/service";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Catálogos de planta",
  robots: { index: false },
};

const PATH = "/panel/catalogos";

/**
 * HU31 · Catálogos de piezas, moldes, lotes y turnos (RIKDP-42) y
 * HU33 · Lotes de producción y turnos (RIKDP-44). Todos los roles de planta
 * consultan; solo el Admin de planta modifica.
 */
export default function CatalogsPage() {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Planta</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Catálogos</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Piezas, moldes, lotes y turnos de tu planta. Cada inspección queda asociada a ellos, así que los que ya se
          usaron se desactivan o se cierran en lugar de borrarse.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando los catálogos…</p>}>
          <CatalogsContent />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function CatalogsContent() {
  const { user, allowed } = await getPageAccess(PATH, "catalogos:ver");
  if (!allowed) return <Forbidden />;
  const actor = toAuthzUser(user);
  const data = await listCatalogs(getDb(), actor);
  const manage = can(actor, "catalogos:gestionar", { empresaId: actor.empresaId });

  return (
    <div className="flex flex-col gap-10">
      <ActiveShift data={data} />
      <Shifts data={data} manage={manage} />
      <Parts data={data} manage={manage} />
      <Batches data={data} manage={manage} />
    </div>
  );
}

function ActiveShift({ data }: { data: Catalogs }) {
  const active = data.shifts.find((s) => s.id === data.activeShiftId);
  return (
    <p role="status" className="ui-card flex flex-wrap items-center gap-2 p-4 text-sm">
      <span className="text-muted-foreground">Turno activo ahora:</span>
      {active ? (
        <strong>
          {active.name} ({active.start}–{active.end})
        </strong>
      ) : (
        <strong>ninguno cubre esta hora</strong>
      )}
      <span className="text-muted-foreground">· hora de la planta ({data.timeZone})</span>
    </p>
  );
}

function Badge({ on, onLabel = "Activo", offLabel = "Inactivo" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-muted-foreground"}`}
    >
      {on ? onLabel : offLabel}
    </span>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Shifts({ data, manage }: { data: Catalogs; manage: boolean }) {
  return (
    <Section id="turnos" title="Turnos">
      {data.shifts.length === 0 ? <p className="text-muted-foreground">Todavía no hay turnos.</p> : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {data.shifts.map((s) => (
          <li key={s.id} className="ui-card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                {s.name}
                {s.id === data.activeShiftId ? <span className="ml-2 text-sm font-normal text-primary">· en curso</span> : null}
              </h3>
              <Badge on={s.active} />
            </div>
            <p className="text-sm text-muted-foreground">
              {s.start} a {s.end}
              {s.crossesMidnight ? " · cruza la medianoche" : ""}
            </p>
            {manage ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-primary">Editar</summary>
                <div className="mt-3 flex flex-col gap-4">
                  <CatalogForm
                    intent="shift:update"
                    id={s.id}
                    submitLabel="Guardar turno"
                    fields={[
                      { name: "name", label: "Nombre", defaultValue: s.name, required: true, maxLength: 40 },
                      { name: "startTime", label: "Inicio", type: "time", defaultValue: s.start, required: true },
                      { name: "endTime", label: "Fin", type: "time", defaultValue: s.end, required: true },
                    ]}
                  />
                  <CatalogForm
                    intent="shift:toggle"
                    id={s.id}
                    hidden={{ active: String(!s.active) }}
                    submitLabel={s.active ? "Desactivar turno" : "Activar turno"}
                    variant="secondary"
                  />
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <div className="ui-card p-5">
          <h3 className="mb-4 font-semibold">Nuevo turno</h3>
          <CatalogForm
            intent="shift:create"
            submitLabel="Registrar turno"
            fields={[
              { name: "name", label: "Nombre", required: true, maxLength: 40, hint: "Ej.: Mañana, Tarde, Noche" },
              { name: "startTime", label: "Inicio", type: "time", required: true },
              { name: "endTime", label: "Fin", type: "time", required: true, hint: "Si es menor que el inicio, el turno cruza la medianoche." },
            ]}
          />
        </div>
      ) : null}
    </Section>
  );
}

function Parts({ data, manage }: { data: Catalogs; manage: boolean }) {
  const activeParts = data.parts.filter((p) => p.active);
  return (
    <Section id="piezas" title="Piezas y moldes">
      {data.parts.length === 0 ? <p className="text-muted-foreground">Todavía no hay piezas.</p> : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {data.parts.map((p) => (
          <li key={p.id} className="ui-card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 font-semibold break-words">
                {p.code} · {p.name}
              </h3>
              <Badge on={p.active} onLabel="Activa" offLabel="Inactiva" />
            </div>
            {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
            <div>
              <p className="mb-2 text-sm font-medium">Moldes</p>
              {p.molds.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin moldes.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {p.molds.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        {m.code} · {m.cavities} {m.cavities === 1 ? "cavidad" : "cavidades"} <Badge on={m.active} />
                      </span>
                      {manage ? (
                        <CatalogForm
                          intent="mold:toggle"
                          id={m.id}
                          hidden={{ active: String(!m.active) }}
                          submitLabel={m.active ? `Desactivar ${m.code}` : `Activar ${m.code}`}
                          variant="secondary"
                          inline
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {manage ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-primary">Editar pieza o agregar molde</summary>
                <div className="mt-3 flex flex-col gap-5">
                  <CatalogForm
                    intent="part:update"
                    id={p.id}
                    submitLabel="Guardar pieza"
                    fields={[
                      { name: "code", label: "Código", defaultValue: p.code, required: true, maxLength: 32 },
                      { name: "name", label: "Nombre", defaultValue: p.name, required: true, maxLength: 100 },
                      { name: "description", label: "Descripción", defaultValue: p.description ?? "", maxLength: 300 },
                    ]}
                  />
                  {p.active ? (
                    <CatalogForm
                      intent="mold:create"
                      submitLabel="Agregar molde"
                      hidden={{ partId: p.id }}
                      fields={[
                        { name: "code", label: "Código del molde", required: true, maxLength: 32 },
                        { name: "cavities", label: "Cavidades", type: "number", defaultValue: "1", min: 1, max: 64 },
                      ]}
                    />
                  ) : null}
                  <CatalogForm
                    intent="part:toggle"
                    id={p.id}
                    hidden={{ active: String(!p.active) }}
                    submitLabel={p.active ? "Desactivar pieza" : "Activar pieza"}
                    variant="secondary"
                  />
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <div className="ui-card p-5">
          <h3 className="mb-4 font-semibold">Nueva pieza</h3>
          <CatalogForm
            intent="part:create"
            submitLabel="Registrar pieza"
            fields={[
              { name: "code", label: "Código", required: true, maxLength: 32, hint: "Ej.: IMP-150" },
              { name: "name", label: "Nombre", required: true, maxLength: 100 },
              { name: "description", label: "Descripción (opcional)", maxLength: 300 },
            ]}
          />
        </div>
      ) : null}
      {manage && activeParts.length === 0 && data.parts.length > 0 ? (
        <p className="text-sm text-muted-foreground">Activa una pieza para poder agregarle moldes.</p>
      ) : null}
    </Section>
  );
}

function Batches({ data, manage }: { data: Catalogs; manage: boolean }) {
  const dateTime = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: data.timeZone });
  const moldOptions = data.parts
    .filter((p) => p.active)
    .flatMap((p) => p.molds.filter((m) => m.active).map((m) => ({ value: m.id, label: `${m.code} · ${p.code}` })));
  return (
    <Section id="lotes" title="Lotes de producción">
      {data.batches.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay lotes.</p>
      ) : (
        <div className="ui-card overflow-x-auto" tabIndex={0} role="region" aria-label="Lotes (se desplaza de lado)">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Lotes de producción</caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr className="[&_th]:px-4 [&_th]:py-3 [&_th]:font-medium">
                <th scope="col">Lote</th>
                <th scope="col">Molde · pieza</th>
                <th scope="col">Estado</th>
                <th scope="col">Inspecciones</th>
                <th scope="col">Apertura</th>
                {manage ? <th scope="col">Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id} className="border-b border-border/60 align-top last:border-0 [&_td]:px-4 [&_td]:py-3">
                  <td className="font-medium">{b.code}</td>
                  <td>
                    {b.mold.code} · {b.mold.part.code}
                  </td>
                  <td>
                    <Badge on={b.status === "OPEN"} onLabel="Abierto" offLabel="Cerrado" />
                  </td>
                  <td className="tabular-nums">{b.inspections}</td>
                  <td className="whitespace-nowrap">
                    {dateTime.format(b.openedAt)}
                    {b.closedAt ? <span className="block text-xs text-muted-foreground">cerrado {dateTime.format(b.closedAt)}</span> : null}
                  </td>
                  {manage ? (
                    <td>
                      <div className="flex flex-col gap-2">
                        <CatalogForm
                          intent={b.status === "OPEN" ? "batch:close" : "batch:reopen"}
                          id={b.id}
                          submitLabel={b.status === "OPEN" ? `Cerrar ${b.code}` : `Reabrir ${b.code}`}
                          variant="secondary"
                          inline
                        />
                        {b.inspections === 0 ? (
                          <CatalogForm
                            intent="batch:delete"
                            id={b.id}
                            submitLabel={`Eliminar ${b.code}`}
                            variant="danger"
                            confirm={`¿Eliminar el lote ${b.code}? No tiene inspecciones.`}
                            inline
                          />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage ? (
        <div className="ui-card p-5">
          <h3 className="mb-4 font-semibold">Abrir un lote</h3>
          {moldOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Primero registra una pieza y un molde activos.</p>
          ) : (
            <CatalogForm
              intent="batch:create"
              submitLabel="Abrir lote"
              fields={[
                { name: "code", label: "Código del lote", required: true, maxLength: 40, hint: "Ej.: L-2026-118" },
                { name: "moldId", label: "Molde", type: "select", required: true, options: moldOptions },
              ]}
            />
          )}
        </div>
      ) : null}
    </Section>
  );
}
