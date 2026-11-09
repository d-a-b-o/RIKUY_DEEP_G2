import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PanelShell } from "@/components/panel/panel-shell";
import { can } from "@/lib/authz";
import { getCurrentUser, toAuthzUser } from "@/lib/auth/session";
import { Icon } from "@/components/ui/icon";

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
      <Suspense
        fallback={<p className="text-muted-foreground">Cargando tu panel…</p>}
      >
        <Welcome />
      </Suspense>
    </PanelShell>
  );
}

async function Welcome() {
  const user = await getCurrentUser("/panel");
  return (
    <section aria-labelledby="bienvenida" className="ui-card overflow-hidden">
      <div className="industrial-grid border-b border-border p-6 sm:p-9">
        <p className="ui-eyebrow mb-5">Tu espacio de trabajo</p>
        <h1
          id="bienvenida"
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Hola, {user.name}
        </h1>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
          Todo listo para mirar cada pieza con el mismo criterio de calidad.
        </p>
      </div>
      <dl className="grid gap-6 p-6 sm:grid-cols-3 sm:p-9 [&_dd]:mt-2 [&_dd]:text-base">
        <div>
          <dt className="text-sm text-muted-foreground">Rol</dt>
          <dd className="font-medium">{roleLabels[user.role] ?? user.role}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Empresa</dt>
          <dd className="font-medium">
            {user.companyName ?? "Plataforma (superadministrador)"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Correo</dt>
          <dd className="break-all font-medium">{user.email}</dd>
        </div>
      </dl>
      {can(toAuthzUser(user), "inspecciones:crear") ? (
        <NextStep
          icon="scan"
          title="Empieza una inspección"
          text="Sube una imagen o utiliza la cámara para analizar una pieza."
          href="/panel/inspeccion"
          action="Inspeccionar una pieza"
        />
      ) : null}
      {can(toAuthzUser(user), "empresas:gestionar") ? (
        <NextStep
          icon="building"
          title="Gestiona las empresas"
          text="Da de alta una planta, invita a su administrador o desactiva su acceso."
          href="/panel/admin/empresas"
          action="Ver empresas"
        />
      ) : null}
    </section>
  );
}

function NextStep({
  icon,
  title,
  text,
  href,
  action,
}: {
  icon: "scan" | "building";
  title: string;
  text: string;
  href: string;
  action: string;
}) {
  return (
    <div className="mx-6 mb-6 flex flex-col gap-6 rounded-xl border border-primary/30 bg-primary/5 p-6 sm:mx-9 sm:mb-9 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon name={icon} className="h-6 w-6" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
        </div>
      </div>
      <Link href={href} className="ui-button shrink-0">
        {action}
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
