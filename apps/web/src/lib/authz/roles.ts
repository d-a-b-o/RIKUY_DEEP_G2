/**
 * HU32 · Acceder según mi rol (RIKDP-43) — matriz de permisos.
 *
 * Fuente única de verdad de qué puede hacer cada rol. Middleware, server
 * actions, rutas de API y menús deben consultar este archivo; nunca deben
 * decidir por su cuenta comparando nombres de rol.
 */

/** Mismos valores que el enum `Role` de Prisma (prisma/schema.prisma). */
export const ROLES = ["SUPERADMIN", "ADMIN", "INSPECTOR", "VIEWER", "STATION"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Admin de planta",
  INSPECTOR: "Inspector",
  VIEWER: "Visualizador",
  STATION: "Estación",
};

/** Permisos con formato `recurso:accion`. */
export const PERMISSIONS = [
  "empresas:gestionar", // HU23 · alta, edición y desactivación de empresas
  "usuarios:gestionar", // HU30 · usuarios de mi planta
  "catalogos:ver", // HU31
  "catalogos:gestionar", // HU31 · piezas, moldes, lotes y turnos
  "inspecciones:crear", // inspección con webcam
  "inspecciones:ver", // HU24 · trazabilidad
  "veredictos:corregir", // HU40
  "dashboard:ver", // HU37
  "reportes:descargar", // HU37
  "modelos:gestionar", // versiones del modelo TF.js
  "auditoria:ver", // HU32 · accesos denegados registrados
  "leads:gestionar", // solicitudes de demo de la landing
  "monitoreo:ver", // HU43 · salud de la aplicación y del modelo
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const LECTURA: Permission[] = ["catalogos:ver", "inspecciones:ver", "dashboard:ver", "reportes:descargar"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Opera la plataforma, no la planta (modelo-datos.md, ADR 0003): no pertenece a
  // ninguna empresa, así que no inspecciona, no corrige y no ve datos de clientes.
  SUPERADMIN: ["empresas:gestionar", "modelos:gestionar", "leads:gestionar", "monitoreo:ver", "auditoria:ver"],
  ADMIN: [
    ...LECTURA,
    "usuarios:gestionar",
    "catalogos:gestionar",
    "inspecciones:crear",
    "veredictos:corregir",
    "auditoria:ver",
  ],
  INSPECTOR: [...LECTURA, "inspecciones:crear", "veredictos:corregir"],
  VIEWER: LECTURA,
  // ADR 0007: cuenta técnica de una estación; registra inspecciones de línea y lee el lote y turno activos.
  STATION: ["catalogos:ver", "inspecciones:crear"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
