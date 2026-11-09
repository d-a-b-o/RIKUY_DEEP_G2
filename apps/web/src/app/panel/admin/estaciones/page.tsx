import type { Metadata } from "next";
import { Suspense } from "react";
import { stationAction } from "./actions";
import { CatalogForm, type FieldSpec } from "@/components/catalogs/catalog-form";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/config";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listStations, type StationList } from "@/lib/station/service";

export const metadata: Metadata = {
  title: "Estaciones automáticas",
  robots: { index: false },
};

const PATH = "/panel/admin/estaciones";

/** HU44-T04 · Estaciones automáticas (RIKDP-271): alta, lote asignado, calibración y activación. */
export default function StationsPage() {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Planta</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Estaciones automáticas</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Cada estación tiene una cuenta técnica que se deja abierta en el equipo de la línea. La estación inspecciona sola
          cada pieza del lote que le asignes, dentro del turno activo.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando las estaciones…</p>}>
          <StationsContent />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function StationsContent() {
  const { user, allowed } = await getPageAccess(PATH, "estaciones:gestionar");
  if (!allowed) return <Forbidden />;
  const data = await listStations(getDb(), toAuthzUser(user));
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="estaciones" className="flex flex-col gap-4">
        <h2 id="estaciones" className="text-xl font-semibold">
          Estaciones
        </h2>
        {data.stations.length === 0 ? <p className="text-muted-foreground">Todavía no hay estaciones.</p> : null}
        {data.stations.map((station) => (
          <Station key={station.id} station={station} batches={data.openBatches} />
        ))}
      </section>
      <section aria-labelledby="nueva-estacion" className="ui-card flex flex-col gap-4 p-5">
        <h2 id="nueva-estacion" className="text-xl font-semibold">
          Nueva estación
        </h2>
        <CatalogForm
          action={stationAction}
          intent="station:create"
          submitLabel="Crear estación"
          fields={[
            { name: "name", label: "Nombre", required: true, maxLength: 60, hint: "Ej.: Estación 1" },
            { name: "line", label: "Línea", required: true, maxLength: 60, hint: "Ej.: Línea de inyección A" },
            { name: "email", label: "Correo de la cuenta técnica", type: "email", required: true, autoComplete: "off" },
            {
              name: "password",
              label: "Contraseña de la cuenta técnica",
              type: "password",
              required: true,
              autoComplete: "new-password",
              hint: `Al menos ${MIN_PASSWORD_LENGTH} caracteres. Guárdala: la necesitas para abrir la estación en el equipo de la línea.`,
            },
          ]}
        />
      </section>
    </div>
  );
}

type StationRow = StationList["stations"][number];

function Station({ station, batches }: { station: StationRow; batches: StationList["openBatches"] }) {
  const lastSeen = station.lastSeenAt
    ? new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short" }).format(station.lastSeenAt)
    : "nunca";
  const batchOptions = batches.map((b) => ({ value: b.id, label: `${b.code} · ${b.mold.code} · ${b.mold.part.code}` }));
  const configFields: FieldSpec[] = [
    { name: "presenceThreshold", label: "Umbral de presencia", type: "number", step: "any", min: 0, max: 1, hint: "0 a 1. Por defecto 0,12." },
    { name: "motionThreshold", label: "Umbral de movimiento", type: "number", step: "any", min: 0, max: 1, hint: "0 a 1. Por defecto 0,02." },
    { name: "stableFrames", label: "Fotogramas quietos antes de inspeccionar", type: "number", min: 1, max: 30 },
    { name: "maxWaitMs", label: "Espera máxima (ms)", type: "number", min: 300, max: 10000, hint: "Si la pieza no se detiene, se inspecciona con aviso." },
    { name: "okPhotoEvery", label: "Foto de 1 de cada N piezas OK", type: "number", min: 1, max: 1000 },
    { name: "targetPiecesPerSecond", label: "Ritmo esperado (piezas/s)", type: "number", step: "any", min: 0, max: 5 },
  ].map((field) => ({ ...field, required: true, defaultValue: String(station.config[field.name as keyof StationRow["config"]]) }) as FieldSpec);

  return (
    <article aria-labelledby={`estacion-${station.id}`} className="ui-card flex flex-col gap-5 p-5" data-testid="estacion">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 id={`estacion-${station.id}`} className="text-lg font-semibold">
          {station.name}
        </h3>
        <span className="text-sm text-muted-foreground">{station.line}</span>
        <span
          className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${station.active ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-muted-foreground"}`}
        >
          {station.active ? "Activa" : "Inactiva"}
        </span>
      </header>
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Cuenta técnica</dt>
          <dd className="break-all">{station.user?.email ?? "sin cuenta"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lote asignado</dt>
          <dd>
            {station.currentBatch ? `${station.currentBatch.code}${station.currentBatch.status === "OPEN" ? "" : " (cerrado)"}` : "ninguno"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Inspecciones</dt>
          <dd className="tabular-nums">{station.inspections}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última conexión</dt>
          <dd>{lastSeen}</dd>
        </div>
      </dl>

      <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer font-medium">Lote asignado</summary>
        <div className="mt-4">
          {batchOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay lotes abiertos. Ábrelos en Catálogos.</p>
          ) : (
            <CatalogForm
              action={stationAction}
              intent="station:batch"
              id={station.id}
              submitLabel="Asignar lote"
              fields={[
                {
                  name: "batchId",
                  label: "Lote",
                  type: "select",
                  options: batchOptions,
                  defaultValue: station.currentBatch?.status === "OPEN" ? station.currentBatch.id : "",
                  hint: "Elige «Elige…» para dejar la estación sin lote.",
                },
              ]}
            />
          )}
        </div>
      </details>

      <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer font-medium">Calibración y parámetros</summary>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Los umbrales también se pueden medir desde la propia estación con la cinta vacía. Valores de referencia en
          docs/arquitectura/inferencia-navegador.md.
        </p>
        <div className="mt-4">
          <CatalogForm action={stationAction} intent="station:config" id={station.id} submitLabel="Guardar parámetros" fields={configFields} />
        </div>
      </details>

      <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer font-medium">Nombre y línea</summary>
        <div className="mt-4">
          <CatalogForm
            action={stationAction}
            intent="station:update"
            id={station.id}
            submitLabel="Guardar"
            fields={[
              { name: "name", label: "Nombre", required: true, maxLength: 60, defaultValue: station.name },
              { name: "line", label: "Línea", required: true, maxLength: 60, defaultValue: station.line },
            ]}
          />
        </div>
      </details>

      <CatalogForm
        action={stationAction}
        intent="station:toggle"
        id={station.id}
        hidden={{ active: String(!station.active) }}
        submitLabel={station.active ? `Desactivar ${station.name}` : `Activar ${station.name}`}
        variant={station.active ? "danger" : "secondary"}
        confirm={station.active ? `¿Desactivar ${station.name}? Se cerrará la sesión de su cuenta técnica.` : undefined}
        inline
      />
    </article>
  );
}
