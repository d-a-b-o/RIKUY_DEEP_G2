import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CorrectVerdictForm } from "@/components/inspection/correct-verdict-form";
import { EVENT_LABELS, SOURCE_LABELS, VERDICT_LABELS, percent, verdictClass } from "@/components/inspection/labels";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { getInspectionTrace, InspectionError, loadActor } from "@/lib/inspections/service";

export const metadata: Metadata = {
  title: "Detalle de inspección",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * HU42-T02 (RIKDP-220): imagen, veredicto, correcciones y versión del modelo.
 * HU40 (RIKDP-51): quien puede corregir ve el formulario de corrección.
 */
export default function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PanelShell>
      <Link href="/panel/inspecciones" className="text-sm text-muted-foreground hover:text-primary">
        ← Historial
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Cargando la inspección…</p>}>
        <Detail params={params} />
      </Suspense>
    </PanelShell>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, allowed } = await getPageAccess(`/panel/inspecciones/${id}`, "inspecciones:ver");
  if (!allowed) return <Forbidden />;
  if (!UUID.test(id)) notFound();

  const db = getDb();
  const actor = await loadActor(db, user.id);
  if (!actor) notFound();

  let trace;
  try {
    trace = await getInspectionTrace({ db }, actor, id);
  } catch (error) {
    if (error instanceof InspectionError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const company = await db.company.findUnique({ where: { id: trace.companyId }, select: { timezone: true } });
  const dateTime = new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: company?.timezone ?? "America/Lima",
  });
  const flagged = trace.events.some((e) => e.type === "FLAGGED_FOR_RETRAINING");
  const canCorrect = can(toAuthzUser(user), "veredictos:corregir", { empresaId: trace.companyId });
  const author = trace.station ? `${trace.station.name} (${trace.station.line})` : (trace.inspector?.name ?? "—");

  return (
    <div className="mt-4 flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Inspección</h1>
        <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${verdictClass(trace.currentVerdict)}`}>
          {VERDICT_LABELS[trace.currentVerdict]}
        </span>
        {flagged ? (
          <span className="inline-flex rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-sm font-medium text-warning">
            Marcada para reentrenamiento
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="foto" className="ui-card flex flex-col gap-4 p-5">
          <h2 id="foto" className="text-lg font-semibold">
            Foto
          </h2>
          {trace.imageUrl ? (
            // La URL está firmada y vence en minutos: no pasa por el optimizador de imágenes.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trace.imageUrl}
              alt={`Pieza ${trace.part.code} inspeccionada el ${dateTime.format(trace.capturedAt)}`}
              className="w-full rounded-lg border border-border object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {trace.imageKey
                ? "La foto existe, pero el almacenamiento de imágenes no está configurado en este entorno."
                : "Sin foto: la estación guarda solo una muestra de las piezas OK."}
            </p>
          )}
        </section>

        <section aria-labelledby="datos" className="ui-card flex flex-col gap-4 p-5">
          <h2 id="datos" className="text-lg font-semibold">
            Datos
          </h2>
          <dl className="grid grid-cols-2 gap-4 text-sm [&_dd]:mt-1 [&_dd]:font-medium [&_dd]:break-words [&_dt]:text-muted-foreground">
            <div>
              <dt>Fecha de captura</dt>
              <dd>{dateTime.format(trace.capturedAt)}</dd>
            </div>
            <div>
              <dt>Origen</dt>
              <dd>{SOURCE_LABELS[trace.source]}</dd>
            </div>
            <div>
              <dt>Veredicto del modelo</dt>
              <dd>{VERDICT_LABELS[trace.predictedVerdict]}</dd>
            </div>
            <div>
              <dt>Confianza · umbral</dt>
              <dd>
                {percent(Number(trace.confidence))} · {Number(trace.thresholdApplied).toFixed(4)}
              </dd>
            </div>
            <div>
              <dt>Versión del modelo</dt>
              <dd>{trace.modelVersion.version}</dd>
            </div>
            <div>
              <dt>Inferencia</dt>
              <dd>
                {trace.inferenceMs !== null ? `${trace.inferenceMs} ms` : "—"}
                {trace.backend ? ` · ${trace.backend}` : ""}
              </dd>
            </div>
            <div>
              <dt>Pieza</dt>
              <dd>
                {trace.part.code} · {trace.part.name}
              </dd>
            </div>
            <div>
              <dt>Molde</dt>
              <dd>{trace.mold.code}</dd>
            </div>
            <div>
              <dt>Lote</dt>
              <dd>{trace.batch.code}</dd>
            </div>
            <div>
              <dt>Turno</dt>
              <dd>{trace.shift.name}</dd>
            </div>
            <div>
              <dt>Registrada por</dt>
              <dd>{author}</dd>
            </div>
            {trace.pieceNumber !== null ? (
              <div>
                <dt>N.º de pieza</dt>
                <dd>{trace.pieceNumber}</dd>
              </div>
            ) : null}
          </dl>
          {trace.warnings.length > 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
              Avisos: {trace.warnings.join(" · ")}
            </p>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="trazabilidad" className="ui-card flex flex-col gap-4 p-5">
        <h2 id="trazabilidad" className="text-lg font-semibold">
          Trazabilidad
        </h2>
        <ol className="flex flex-col gap-4 border-l border-border pl-5">
          {trace.events.map((event, index) => (
            <li key={index} className="text-sm">
              <p className="font-medium">
                {EVENT_LABELS[event.type]}
                {event.type === "CORRECTED" && event.previousVerdict && event.newVerdict
                  ? `: ${VERDICT_LABELS[event.previousVerdict]} → ${VERDICT_LABELS[event.newVerdict]}`
                  : ""}
              </p>
              <p className="text-muted-foreground">
                {dateTime.format(event.createdAt)}
                {event.actor ? ` · ${event.actor.name}` : ""}
              </p>
              {event.reason && event.type === "CORRECTED" ? <p className="mt-1">Motivo: {event.reason}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      {canCorrect ? (
        <section aria-labelledby="corregir" className="ui-card flex flex-col gap-4 p-5">
          <h2 id="corregir" className="text-lg font-semibold">
            Corregir el veredicto
          </h2>
          <CorrectVerdictForm inspectionId={trace.id} currentVerdict={trace.currentVerdict} />
        </section>
      ) : null}
    </div>
  );
}
