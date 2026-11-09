import type { Metadata } from "next";
import { Suspense } from "react";
import { PanelShell } from "@/components/panel/panel-shell";
import { CompanyPolicy } from "@/components/security/company-policy";
import { TwoFactorSettings } from "@/components/security/two-factor-settings";
import { can } from "@/lib/authz";
import { SECURITY_PATH } from "@/lib/auth/config";
import { getCurrentUser, toAuthzUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Seguridad",
  robots: { index: false },
};

export default function SecurityPage() {
  return (
    <PanelShell>
      <p className="ui-eyebrow mb-3">Mi cuenta</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Seguridad</h1>
      <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
        Protege tu cuenta con un segundo paso: aunque alguien conozca tu contraseña, no podrá entrar sin tu móvil.
      </p>
      <Suspense fallback={<p className="mt-8 text-muted-foreground">Cargando…</p>}>
        <SecuritySections />
      </Suspense>
    </PanelShell>
  );
}

async function SecuritySections() {
  const user = await getCurrentUser(SECURITY_PATH);
  const managesPlant = Boolean(user.companyId) && can(toAuthzUser(user), "usuarios:gestionar", { empresaId: user.companyId });
  const company =
    managesPlant && user.companyId
      ? await getDb().company.findUnique({ where: { id: user.companyId }, select: { name: true, requireTwoFactor: true } })
      : null;

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="dos-pasos" className="ui-card p-6 sm:p-8">
        <h2 id="dos-pasos" className="mb-5 text-lg font-semibold">
          Verificación en dos pasos
        </h2>
        <TwoFactorSettings enabled={user.twoFactorEnabled} required={user.twoFactorRequired} />
      </section>
      {company && user.twoFactorEnabled ? (
        <section aria-labelledby="politica" className="ui-card p-6 sm:p-8">
          <h2 id="politica" className="mb-5 text-lg font-semibold">
            Política de la planta
          </h2>
          <CompanyPolicy companyName={company.name} required={company.requireTwoFactor} />
        </section>
      ) : null}
    </div>
  );
}
