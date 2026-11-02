import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/brand/logo";
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
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <Suspense fallback={<p className="text-muted-foreground">Cargando tu panel…</p>}>
          <Welcome />
        </Suspense>
      </main>
    </div>
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
    </section>
  );
}
