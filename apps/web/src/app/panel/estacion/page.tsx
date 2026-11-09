import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { StationKiosk } from "@/components/station/station-kiosk";
import { getPageAccess } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadActor } from "@/lib/inspections/service";
import { loadStationContext } from "@/lib/station/service";

export const metadata: Metadata = {
  title: "Estación automática",
  robots: { index: false },
};

const PATH = "/panel/estacion";

/** HU44 · Estación de inspección automática (RIKDP-55). Solo para la cuenta técnica. */
export default function StationPage() {
  return (
    <PanelShell>
      <Suspense fallback={<p className="text-muted-foreground">Preparando la estación…</p>}>
        <StationContent />
      </Suspense>
    </PanelShell>
  );
}

async function StationContent() {
  const { user, allowed } = await getPageAccess(PATH, "estacion:operar");
  if (!allowed) return <Forbidden />;
  const actor = await loadActor(getDb(), user.id);
  if (!actor?.stationId) {
    return (
      <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
        Esta cuenta técnica no tiene una estación activa. Pide al Admin de planta que la active en Estaciones.
      </p>
    );
  }
  const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;
  const context = await loadStationContext(getDb(), actor);
  if (!manifestUrl) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          {context.station.name} · {context.station.line}
        </h1>
        <p data-testid="estacion-lote">Lote: {context.batch?.code ?? "sin asignar"}</p>
        <p data-testid="estacion-turno">Turno: {context.shift?.name ?? "ninguno activo"}</p>
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          La inspección aún no está configurada. Contacta al responsable de tu planta para habilitar el modelo.
        </p>
      </div>
    );
  }
  return (
    <>
      <h1 className="sr-only">Estación automática {context.station.name}</h1>
      <StationKiosk initial={context} manifestUrl={manifestUrl} />
    </>
  );
}
