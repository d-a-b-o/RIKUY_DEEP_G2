import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PanelShell } from "@/components/panel/panel-shell";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Panel",
  robots: { index: false },
};

const roleLabels: Record<string, string> = {
  SUPERADMIN: "Superadministrador",
  ADMIN: "Administrador de planta",
  INSPECTOR: "Inspector de calidad",
  VIEWER: "Consulta",
  STATION: "Estación de inspección",
};

export default function PanelPage() {
  return (
    <PanelShell>
      <Suspense fallback={<p className="text-muted-foreground">Cargando tu panel…</p>}>
        <Welcome />
      </Suspense>
    </PanelShell>
  );
}

async function Welcome() {
  const user = await getCurrentUser("/panel");
  return (
    <section aria-labelledby="bienvenida" className="rounded-2xl border border-border bg-background p-6 sm:p-8">
      <h1 id="bienvenida" className="text-2xl font-bold tracking-tight">
        Hola, {user.name}
      </h1>
      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Rol</dt>
          <dd className="font-medium">{roleLabels[user.role] ?? user.role}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Empresa</dt>
          <dd className="font-medium">{user.companyName ?? "Todas (superadministrador)"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Correo</dt>
          <dd className="break-all font-medium">{user.email}</dd>
        </div>
      </dl>
      <Link
        href="/panel/inspeccion"
        className="mt-8 inline-flex h-11 items-center rounded-lg bg-accent px-5 font-semibold text-accent-foreground transition-opacity hover:opacity-90"
      >
        Inspeccionar una pieza
      </Link>
    </section>
  );
}
