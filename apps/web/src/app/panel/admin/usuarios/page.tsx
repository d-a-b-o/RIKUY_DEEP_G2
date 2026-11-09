import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { userAction } from "./actions";
import { CatalogForm } from "@/components/catalogs/catalog-form";
import { Forbidden } from "@/components/panel/forbidden";
import { PanelShell } from "@/components/panel/panel-shell";
import { InviteUserForm } from "@/components/users/invite-user-form";
import { getPageAccess, toAuthzUser } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { listPlantUsers, userFiltersSchema, type UserFilters } from "@/lib/users/service";

export const metadata: Metadata = {
  title: "Usuarios de la planta",
  robots: { index: false },
};

const PATH = "/panel/admin/usuarios";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** HU30 · Gestionar usuarios de mi planta (RIKDP-41). Solo el Admin de planta. */
export default function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PanelShell>
      <div>
        <p className="ui-eyebrow mb-3">Planta</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Usuarios</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Invita a inspectores y visualizadores, cambia su rol o desactiva su acceso. Al desactivar una cuenta se cierran
          sus sesiones abiertas.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<p className="text-muted-foreground">Cargando usuarios…</p>}>
          <Users searchParams={searchParams} />
        </Suspense>
      </div>
    </PanelShell>
  );
}

async function Users({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(PATH, "usuarios:gestionar");
  if (!allowed) return <Forbidden />;
  const params = await searchParams;
  const filters = userFiltersSchema.parse({ q: first(params.q), rol: first(params.rol), estado: first(params.estado) });
  const data = await listPlantUsers(getDb(), toAuthzUser(user), filters);
  const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeZone: "America/Lima" });

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="invitar" className="ui-card flex flex-col gap-4 p-5">
        <h2 id="invitar" className="text-lg font-semibold">
          Invitar a un usuario
        </h2>
        <InviteUserForm />
      </section>

      {data.invitations.length > 0 ? (
        <section aria-labelledby="pendientes" className="flex flex-col gap-3">
          <h2 id="pendientes" className="text-lg font-semibold">
            Invitaciones pendientes
          </h2>
          <ul className="flex flex-col gap-2">
            {data.invitations.map((i) => (
              <li key={i.id} className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span className="min-w-0 break-all">
                  <strong>{i.email}</strong> · {ROLE_LABELS[i.role as Role]}
                  <span className="block text-muted-foreground">Vence el {dateFormat.format(i.expiresAt)}</span>
                </span>
                <CatalogForm
                  action={userAction}
                  intent="invitation:revoke"
                  id={i.id}
                  submitLabel={`Anular invitación a ${i.email}`}
                  variant="secondary"
                  inline
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="lista" className="flex flex-col gap-4">
        <h2 id="lista" className="text-lg font-semibold">
          Usuarios de la planta
        </h2>
        <Filters filters={filters} />
        {data.users.length === 0 ? (
          <p className="ui-card p-6 text-muted-foreground">No hay usuarios con estos filtros.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2" aria-label="Usuarios">
            {data.users.map((u) => (
              <li key={u.id} className="ui-card flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words">{u.name}</h3>
                    <p className="text-sm break-all text-muted-foreground">{u.email}</p>
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${u.active ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-muted-foreground"}`}
                  >
                    {u.active ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <p className="text-sm">
                  {ROLE_LABELS[u.role as Role] ?? u.role}
                  {u.id === user.id ? <span className="text-muted-foreground"> · tú</span> : null}
                  <span className="text-muted-foreground"> · alta {dateFormat.format(u.createdAt)}</span>
                </p>
                {u.editable ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-primary">Editar o desactivar</summary>
                    <div className="mt-3 flex flex-col gap-4">
                      <CatalogForm
                        action={userAction}
                        intent="user:update"
                        id={u.id}
                        submitLabel="Guardar cambios"
                        fields={[
                          { name: "name", label: "Nombre", defaultValue: u.name, required: true, maxLength: 100 },
                          {
                            name: "role",
                            label: "Rol",
                            type: "select",
                            defaultValue: u.role,
                            options: [
                              { value: "INSPECTOR", label: "Inspector" },
                              { value: "VIEWER", label: "Visualizador" },
                            ],
                          },
                        ]}
                      />
                      <CatalogForm
                        action={userAction}
                        intent="user:toggle"
                        id={u.id}
                        hidden={{ active: String(!u.active) }}
                        submitLabel={u.active ? `Desactivar a ${u.name}` : `Activar a ${u.name}`}
                        variant={u.active ? "danger" : "secondary"}
                        confirm={u.active ? `¿Desactivar a ${u.name}? Se cerrarán sus sesiones abiertas.` : undefined}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Filters({ filters }: { filters: UserFilters }) {
  return (
    <form method="get" action={PATH} className="ui-card flex flex-col gap-4 p-5 sm:flex-row sm:items-end" aria-label="Filtrar usuarios">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Buscar</span>
        <input name="q" defaultValue={filters.q} placeholder="Nombre o correo" className="ui-input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Rol</span>
        <select name="rol" defaultValue={filters.rol ?? ""} className="ui-input">
          <option value="">Todos</option>
          <option value="ADMIN">Admin de planta</option>
          <option value="INSPECTOR">Inspector</option>
          <option value="VIEWER">Visualizador</option>
          <option value="STATION">Estación</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Estado</span>
        <select name="estado" defaultValue={filters.estado ?? ""} className="ui-input">
          <option value="">Todos</option>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
        </select>
      </label>
      <div className="flex gap-3">
        <button type="submit" className="ui-button">
          Filtrar
        </button>
        <Link href={PATH} className="ui-button ui-button-secondary">
          Limpiar
        </Link>
      </div>
    </form>
  );
}
