import { can, type Permission } from "@/lib/authz";
import { getOptionalUser, toAuthzUser } from "@/lib/auth/session";
import type { PanelLink } from "./panel-links";
import { PanelNav } from "./panel-nav";

/** Enlaces del panel y el permiso que exige cada uno (HU32). La protección real está en cada página. */
const LINKS: readonly (PanelLink & { permission?: Permission })[] = [
  { href: "/panel", label: "Inicio", icon: "grid" },
  { href: "/panel/inspeccion", label: "Inspeccionar", icon: "scan", permission: "inspecciones:crear" },
  { href: "/panel/dashboard", label: "Dashboard", icon: "alert", permission: "dashboard:ver" },
  { href: "/panel/inspecciones", label: "Historial", icon: "check", permission: "inspecciones:ver" },
  { href: "/panel/reportes", label: "Reportes", icon: "upload", permission: "reportes:descargar" },
  { href: "/panel/catalogos", label: "Catálogos", icon: "grid", permission: "catalogos:ver" },
  { href: "/panel/admin/usuarios", label: "Usuarios", icon: "building", permission: "usuarios:gestionar" },
  { href: "/panel/admin/empresas", label: "Empresas", icon: "building", permission: "empresas:gestionar" },
  { href: "/panel/admin/auditoria", label: "Auditoría", icon: "shield", permission: "auditoria:ver" },
];

export const BASE_LINKS: readonly PanelLink[] = [LINKS[0]];

/** Menú según el rol de la sesión. Mientras carga se muestra solo «Inicio». */
export async function RoleNav() {
  const user = await getOptionalUser();
  const authz = user ? toAuthzUser(user) : null;
  const links = LINKS.filter((link) => !link.permission || can(authz, link.permission)).map(
    ({ href, label, icon }) => ({ href, label, icon }),
  );
  return <PanelNav links={links} />;
}
