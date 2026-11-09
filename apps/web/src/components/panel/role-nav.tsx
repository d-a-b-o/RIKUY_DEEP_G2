import { can, type Permission } from "@/lib/authz";
import { SECURITY_PATH } from "@/lib/auth/config";
import { getOptionalUser, toAuthzUser } from "@/lib/auth/session";
import type { PanelLink } from "./panel-links";
import { PanelNav } from "./panel-nav";

/** Enlaces del panel y el permiso que exige cada uno (HU32). La protección real está en cada página. */
const LINKS: readonly (PanelLink & { permission?: Permission })[] = [
  { href: "/panel", label: "Inicio", icon: "grid" },
  { href: "/panel/inspeccion", label: "Inspeccionar", icon: "scan", permission: "inspecciones:crear" },
  { href: "/panel/admin/empresas", label: "Empresas", icon: "building", permission: "empresas:gestionar" },
  { href: SECURITY_PATH, label: "Seguridad", icon: "shield" },
];

export const BASE_LINKS: readonly PanelLink[] = [LINKS[0]];

/** Menú según el rol de la sesión. Mientras carga se muestra solo «Inicio». */
export async function RoleNav() {
  const user = await getOptionalUser();
  // Obligada a usar 2FA sin activarla: solo puede ir a configurarla (HU29).
  if (user && user.twoFactorRequired && !user.twoFactorEnabled) {
    return <PanelNav links={LINKS.filter((link) => link.href === SECURITY_PATH).map(({ href, label, icon }) => ({ href, label, icon }))} />;
  }
  const authz = user ? toAuthzUser(user) : null;
  const links = LINKS.filter((link) => !link.permission || can(authz, link.permission)).map(
    ({ href, label, icon }) => ({ href, label, icon }),
  );
  return <PanelNav links={links} />;
}
