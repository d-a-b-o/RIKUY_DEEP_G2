import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CompanyForm } from "@/components/companies/company-form";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Nueva empresa",
  robots: { index: false },
};

export default function NewCompanyPage() {
  return (
    <PanelShell>
      <Link href="/panel/admin/empresas" className="text-sm text-muted-foreground hover:text-primary">
        ← Empresas
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Nueva empresa</h1>
      <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
        Al crearla, su administrador recibe un correo para entrar y configurar la planta.
      </p>
      <div className="ui-card mt-8 max-w-2xl p-6 sm:p-8">
        <Suspense fallback={<p className="text-muted-foreground">Comprobando tu sesión…</p>}>
          <AuthorizedForm />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function AuthorizedForm() {
  const { allowed } = await getPageAccess("/panel/admin/empresas/nueva", "empresas:gestionar");
  if (!allowed) return <Forbidden />;
  return <CompanyForm mode="create" />;
}
