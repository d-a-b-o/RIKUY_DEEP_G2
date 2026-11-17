import type { Metadata } from "next";
import Link from "next/link";
import { PanelShell } from "@/components/panel/panel-shell";
import { Forbidden } from "@/components/panel/forbidden";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { databaseHealth, modelHealth } from "@/lib/monitoring/health";
import { loadMonitoring } from "@/lib/monitoring/service";

export const metadata: Metadata = { title: "Salud de la aplicación", robots: { index: false } };
export const dynamic = "force-dynamic";
export default async function MonitoringPage() {
  const { user, allowed } = await getPageAccess("/panel/admin/monitoreo", "monitoreo:ver");
  if (!allowed) return <PanelShell><Forbidden /></PanelShell>;
  const [database, model, telemetry] = await Promise.all([
    databaseHealth(), modelHealth(),
    loadMonitoring(getDb(), toAuthzUser(user)).catch(() => null),
  ]);
  const fmt = (n: number | null) => n === null ? "—" : `${Math.round(n)} ms`;
  return <PanelShell>
    <h1 className="text-3xl font-semibold">Salud de la aplicación y del modelo</h1>
    <p className="mt-3 text-muted-foreground">Comprobación actual. No representa un porcentaje histórico de disponibilidad.</p>
    <Link href="/panel/admin/monitoreo" prefetch={false} className="ui-button mt-5">Actualizar estado</Link>
    <dl className="mt-6 grid gap-4 sm:grid-cols-2">
      {[{ label: "Aplicación y base de datos", health: database }, { label: "Manifest del modelo", health: model }].map(({ label, health }) =>
        <div key={label} className="ui-card p-5"><dt>{label}</dt><dd className="mt-2 font-semibold">{health.ok ? "Disponible" : "No disponible"}</dd>
          <dd className="mt-2 text-sm text-muted-foreground">{health.durationMs} ms · {new Date(health.checkedAt).toLocaleString("es-PE", { timeZone: "America/Lima" })} (Lima)</dd></div>)}
    </dl>
    <h2 className="mt-8 text-xl font-semibold">Métricas recibidas en las últimas 24 horas</h2>
    <p className="mt-2 text-muted-foreground">Tiempos de inferencia del navegador, sin calentamiento. Los envíos son de mejor esfuerzo: pueden perderse al cerrar el navegador o durante una desconexión. No incluyen captura ni guardado.</p>
    {!telemetry ? <p role="alert" className="ui-card mt-4 p-5">No se pudieron consultar las métricas. Intenta actualizar el estado.</p>
      : !telemetry.metrics.length ? <p className="ui-card mt-4 p-5">Sin eventos recibidos en este período. Esto no confirma que el modelo funcione correctamente.</p>
      : <div className="ui-card mt-5 overflow-x-auto" role="region" aria-label="Métricas del modelo" tabIndex={0}>
        <table className="w-full text-left text-sm"><caption className="sr-only">Tiempos y errores de carga por versión y motor</caption>
          <thead><tr>{["Evento", "Versión", "Motor / etapa", "Eventos", "Promedio", "Percentil 95"].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
          <tbody>{telemetry.metrics.map((row, i) => <tr key={i} className="border-t border-border">
            <td className="p-3">{row.type === "INFERENCE" ? "Inferencia" : "Error de carga"}</td><td className="p-3">{row.version ?? "Sin identificar"}</td>
            <td className="p-3">{row.backend ?? row.stage ?? "—"}</td><td className="p-3">{row.count}</td><td className="p-3">{fmt(row.averageMs)}</td><td className="p-3">{fmt(row.p95Ms)}</td>
          </tr>)}</tbody></table></div>}
  </PanelShell>;
}
