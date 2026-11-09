import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CompanyForm } from "@/components/companies/company-form";
import { InviteAdminForm } from "@/components/companies/invite-admin-form";
import { CompanyStatusBadge } from "@/components/companies/status-badge";
import { StatusToggle } from "@/components/companies/status-toggle";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { CompanyError, getCompany } from "@/lib/companies/service";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Empresa",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PanelShell>
      <Link href="/panel/admin/empresas" className="text-sm text-muted-foreground hover:text-primary">
        ← Empresas
      </Link>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Cargando la empresa…</p>}>
        <CompanyDetail params={params} />
      </Suspense>
    </PanelShell>
  );
}

function invitationState(invitation: { acceptedAt: Date | null; expiresAt: Date }, now: Date): string {
  if (invitation.acceptedAt) return `Aceptada el ${dateFormat.format(invitation.acceptedAt)}`;
  if (invitation.expiresAt <= now) return "Vencida o reemplazada";
  return `Pendiente, vence el ${dateFormat.format(invitation.expiresAt)}`;
}

async function CompanyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, allowed } = await getPageAccess(`/panel/admin/empresas/${id}`, "empresas:gestionar");
  if (!allowed) return <Forbidden />;
  if (!UUID.test(id)) notFound();

  let company;
  try {
    company = await getCompany(getDb(), toAuthzUser(user), id);
  } catch (error) {
    if (error instanceof CompanyError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const now = new Date();

  return (
    <div className="mt-4 flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{company.name}</h1>
        <CompanyStatusBadge status={company.status} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="datos" className="ui-card p-6 sm:p-8">
          <h2 id="datos" className="mb-5 text-lg font-semibold">
            Datos
          </h2>
          <CompanyForm
            mode="edit"
            companyId={company.id}
            defaults={{ name: company.name, taxId: company.taxId, timezone: company.timezone }}
          />
        </section>

        <div className="flex flex-col gap-8">
          <section aria-labelledby="administradores" className="ui-card p-6 sm:p-8">
            <h2 id="administradores" className="mb-5 text-lg font-semibold">
              Administradores
            </h2>
            {company.users.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nadie ha aceptado todavía la invitación.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {company.users.map((admin) => (
                  <li key={admin.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{admin.name}</span>
                    <span className="break-all text-muted-foreground">
                      {admin.email}
                      {admin.active ? "" : " · desactivado"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mb-3 mt-8 font-semibold">Invitaciones</h3>
            {company.invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin invitaciones.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {company.invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-col gap-0.5">
                    <span className="break-all font-medium">{invitation.email}</span>
                    <span className="text-muted-foreground">{invitationState(invitation, now)}</span>
                  </li>
                ))}
              </ul>
            )}

            {company.status === "ACTIVE" ? (
              <div className="mt-8 border-t border-border pt-6">
                <h3 className="mb-4 font-semibold">Invitar a un administrador</h3>
                <InviteAdminForm companyId={company.id} />
              </div>
            ) : null}
          </section>

          <section aria-labelledby="estado" className="ui-card p-6 sm:p-8">
            <h2 id="estado" className="mb-4 text-lg font-semibold">
              Acceso
            </h2>
            <StatusToggle companyId={company.id} status={company.status} />
          </section>
        </div>
      </div>
    </div>
  );
}
