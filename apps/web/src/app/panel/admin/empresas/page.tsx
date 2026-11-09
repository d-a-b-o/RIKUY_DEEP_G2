import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CompanyStatusBadge } from "@/components/companies/status-badge";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { Icon } from "@/components/ui/icon";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { listCompanies } from "@/lib/companies/service";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Empresas",
  robots: { index: false },
};

const PATH = "/panel/admin/empresas";
const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeZone: "America/Lima" });

export default function CompaniesPage() {
  return (
    <PanelShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-eyebrow mb-3">Plataforma</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Empresas</h1>
          <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
            Plantas que usan RikuyDeep. Da de alta una nueva, invita a su administrador o desactiva su acceso.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando empresas…</p>}>
          <CompanyList />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function CompanyList() {
  const { user, allowed } = await getPageAccess(PATH, "empresas:gestionar");
  if (!allowed) return <Forbidden />;
  const companies = await listCompanies(getDb(), toAuthzUser(user));

  return (
    <div className="flex flex-col gap-6">
      <Link href={`${PATH}/nueva`} className="ui-button self-start">
        Nueva empresa
        <Icon name="arrow" />
      </Link>
      {companies.length === 0 ? (
        <p className="ui-card p-6 text-muted-foreground">Todavía no hay empresas. Crea la primera.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Empresas">
          {companies.map((company) => (
            <li key={company.id} className="ui-card flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="min-w-0 text-lg font-semibold">
                  <Link href={`${PATH}/${company.id}`} className="break-words hover:text-primary">
                    {company.name}
                  </Link>
                </h2>
                <CompanyStatusBadge status={company.status} />
              </div>
              <dl className="grid grid-cols-3 gap-3 text-sm [&_dd]:mt-1 [&_dd]:font-medium [&_dt]:text-muted-foreground">
                <div>
                  <dt>RUC</dt>
                  <dd className="break-all">{company.taxId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Usuarios</dt>
                  <dd>{company.activeUsers}</dd>
                </div>
                <div>
                  <dt>Invitaciones</dt>
                  <dd>{company.pendingInvitations}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">Alta: {dateFormat.format(company.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
