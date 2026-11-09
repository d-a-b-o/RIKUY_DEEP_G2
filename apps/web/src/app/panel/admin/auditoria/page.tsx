import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import type { DenialReason } from "@/lib/authz";
import { DENIED_ACCESS_PAGE_SIZE, listDeniedAccesses, type DeniedAccessView } from "@/lib/authz/denied-log";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Accesos denegados",
  robots: { index: false },
};

const PATH = "/panel/admin/auditoria";
const dateFormat = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "America/Lima",
});

const REASON_LABELS: Record<DenialReason, string> = {
  NO_AUTENTICADO: "Sin sesión",
  ROL_INVALIDO: "Rol desconocido",
  SIN_PERMISO: "Su rol no tiene el permiso",
  OTRA_EMPRESA: "Recurso de otra empresa",
};

/** HU32-T03 (RIKDP-181): últimos intentos de usar algo que el rol no permite. */
export default function DeniedAccessPage() {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Seguridad</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Accesos denegados</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Cada vez que alguien intenta abrir una sección o hacer una acción que su rol no permite, el sistema lo
          bloquea con un 403 y lo anota aquí. Se muestran los {DENIED_ACCESS_PAGE_SIZE} más recientes.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando el registro…</p>}>
          <DeniedAccessList />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function DeniedAccessList() {
  const { user, allowed } = await getPageAccess(PATH, "auditoria:ver");
  if (!allowed) return <Forbidden />;
  const authzUser = toAuthzUser(user);
  const entries = await listDeniedAccesses(getDb(), authzUser);
  const showCompany = authzUser.role === "SUPERADMIN";

  if (entries.length === 0) {
    return <p className="ui-card p-6 text-muted-foreground">No hay accesos denegados registrados.</p>;
  }

  return (
    <div className="ui-card overflow-x-auto" tabIndex={0} role="region" aria-label="Accesos denegados (se desplaza de lado)">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Accesos denegados más recientes</caption>
        <thead className="border-b border-border text-muted-foreground">
          <tr className="[&_th]:px-4 [&_th]:py-3 [&_th]:font-medium">
            <th scope="col">Fecha</th>
            <th scope="col">Usuario</th>
            {showCompany ? <th scope="col">Empresa</th> : null}
            <th scope="col">Intentó</th>
            <th scope="col">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Row key={entry.id} entry={entry} showCompany={showCompany} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ entry, showCompany }: { entry: DeniedAccessView; showCompany: boolean }) {
  return (
    <tr className="border-b border-border/60 last:border-0 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
      <td className="whitespace-nowrap tabular-nums">{dateFormat.format(entry.createdAt)}</td>
      <td>
        {entry.userName ? (
          <>
            <span className="font-medium">{entry.userName}</span>
            <span className="block text-xs break-all text-muted-foreground">{entry.userEmail}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Sin sesión</span>
        )}
      </td>
      {showCompany ? <td>{entry.companyName ?? "—"}</td> : null}
      <td>
        <code className="break-all">{entry.path}</code>
        <span className="block text-xs text-muted-foreground">
          {entry.method}
          {entry.permission ? ` · requiere ${entry.permission}` : ""}
        </span>
      </td>
      <td>{entry.reason ? REASON_LABELS[entry.reason] : "—"}</td>
    </tr>
  );
}
