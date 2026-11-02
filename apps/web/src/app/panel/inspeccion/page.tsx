import type { Metadata } from "next";
import { Suspense } from "react";
import { Inspector } from "@/components/inspection/inspector";
import { PanelShell } from "@/components/panel/panel-shell";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Inspeccionar una pieza",
  robots: { index: false },
};

export default function InspectionPage() {
  return (
    <PanelShell>
      <div className="flex flex-col gap-2">
        <p className="ui-eyebrow mb-3">Control visual</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Inspeccionar una pieza
        </h1>
        <p className="max-w-2xl leading-7 text-muted-foreground">
          El modelo de IA se ejecuta en tu navegador y clasifica la pieza como
          OK o defectuosa en menos de un segundo.
        </p>
      </div>
      <div className="mt-6">
        <Suspense
          fallback={
            <p className="text-muted-foreground">Comprobando tu sesión…</p>
          }
        >
          <AuthorizedInspector />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function AuthorizedInspector() {
  await getCurrentUser("/panel/inspeccion");
  const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;
  if (!manifestUrl) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm"
      >
        Falta configurar <code>NEXT_PUBLIC_MODEL_MANIFEST_URL</code>: la URL del
        manifest de modelos en R2.
      </p>
    );
  }
  return <Inspector manifestUrl={manifestUrl} />;
}
