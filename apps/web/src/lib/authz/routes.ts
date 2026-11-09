/**
 * HU32 · Acceder según mi rol (RIKDP-43) — permisos por ruta.
 *
 * El proxy de Next.js 16, antes llamado middleware (src/proxy.ts, HU32-T02), usa
 * requiredPermission(pathname) para responder 403 antes de renderizar la página.
 * Las rutas fuera de /panel son las previstas en las historias; muévelas a
 * /panel cuando existan las pantallas reales.
 */
import type { Permission } from "./roles";

export interface RouteRule {
  prefix: string;
  permission: Permission;
}

/** Página que el proxy muestra, con estado 403, cuando el rol no alcanza. */
export const FORBIDDEN_PATH = "/panel/sin-permiso";

// Orden: de lo más específico a lo más general.
export const ROUTE_RULES: readonly RouteRule[] = [
  // Pantallas ya construidas, dentro de /panel (protegido por src/proxy.ts).
  { prefix: "/panel/admin/empresas", permission: "empresas:gestionar" },
  { prefix: "/panel/admin/auditoria", permission: "auditoria:ver" },
  { prefix: "/panel/inspeccion", permission: "inspecciones:crear" },
  { prefix: "/panel/inspecciones", permission: "inspecciones:ver" },
  { prefix: "/panel/reportes", permission: "reportes:descargar" },
  { prefix: "/panel/catalogos", permission: "catalogos:ver" },
  { prefix: "/panel/admin/usuarios", permission: "usuarios:gestionar" },
  // Previstas por las historias.
  { prefix: "/admin/empresas", permission: "empresas:gestionar" },
  { prefix: "/admin/modelos", permission: "modelos:gestionar" },
  { prefix: "/admin/usuarios", permission: "usuarios:gestionar" },
  { prefix: "/admin/auditoria", permission: "auditoria:ver" },
  { prefix: "/catalogos", permission: "catalogos:ver" },
  { prefix: "/inspecciones/nueva", permission: "inspecciones:crear" },
  { prefix: "/inspecciones", permission: "inspecciones:ver" },
  { prefix: "/reportes", permission: "reportes:descargar" },
  { prefix: "/dashboard", permission: "dashboard:ver" },
  { prefix: "/api/usuarios", permission: "usuarios:gestionar" },
  { prefix: "/api/catalogos", permission: "catalogos:gestionar" },
  { prefix: "/api/inspecciones", permission: "inspecciones:crear" },
  { prefix: "/api/reportes", permission: "reportes:descargar" },
];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Permiso que exige la ruta, o null si es pública o no está protegida por rol. */
export function requiredPermission(pathname: string): Permission | null {
  const rule = ROUTE_RULES.find((r) => matches(pathname, r.prefix));
  return rule ? rule.permission : null;
}
