import { describe, expect, it, vi } from "vitest";
import type { AuthzUser, DeniedAccess } from "./authorize";
import { checkRouteAccess, type RouteAccessDeps } from "./route-access";
import { FORBIDDEN_PATH } from "./routes";

/** HU32-T02 (RIKDP-180): decisión del proxy para las rutas del panel. */

const inspector: AuthzUser = { id: "u2", role: "INSPECTOR", empresaId: "emp-A" };
const superadmin: AuthzUser = { id: "u0", role: "SUPERADMIN", empresaId: null };

function deps(user: AuthzUser | null) {
  const logged: DeniedAccess[] = [];
  const d: RouteAccessDeps = {
    loadUser: vi.fn(async () => user),
    logger: (entry) => {
      logged.push(entry);
    },
  };
  return { deps: d, logged };
}

const request = (pathname: string, ip = "190.0.0.1") => ({
  pathname,
  method: "GET",
  headers: new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` }),
});

describe("checkRouteAccess", () => {
  it("deja pasar las rutas del panel que no exigen permiso sin leer la sesión", async () => {
    const { deps: d } = deps(inspector);
    await expect(checkRouteAccess(request("/panel"), d)).resolves.toEqual({ allowed: true });
    expect(d.loadUser).not.toHaveBeenCalled();
  });

  it("deja pasar si el rol tiene el permiso", async () => {
    const { deps: d, logged } = deps(inspector);
    await expect(checkRouteAccess(request("/panel/inspeccion"), d)).resolves.toEqual({ allowed: true });
    expect(logged).toHaveLength(0);
  });

  it("niega con 403 y registra el intento si el rol no alcanza", async () => {
    const { deps: d, logged } = deps(inspector);
    await expect(checkRouteAccess(request("/panel/admin/empresas/123"), d)).resolves.toEqual({
      allowed: false,
      permission: "empresas:gestionar",
      forbiddenPath: FORBIDDEN_PATH,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      userId: "u2",
      role: "INSPECTOR",
      permission: "empresas:gestionar",
      reason: "SIN_PERMISO",
      empresaId: "emp-A",
      path: "/panel/admin/empresas/123",
      method: "GET",
      ip: "190.0.0.1",
    });
  });

  it("el Superadmin no entra a la inspección: no opera la planta", async () => {
    const { deps: d, logged } = deps(superadmin);
    await expect(checkRouteAccess(request("/panel/inspeccion"), d)).resolves.toMatchObject({ allowed: false });
    expect(logged[0]).toMatchObject({ permission: "inspecciones:crear", reason: "SIN_PERMISO" });
  });

  it("la auditoría es para Admin de planta y Superadmin", async () => {
    await expect(checkRouteAccess(request("/panel/admin/auditoria"), deps(superadmin).deps)).resolves.toEqual({
      allowed: true,
    });
    await expect(checkRouteAccess(request("/panel/admin/auditoria"), deps(inspector).deps)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("sin sesión válida deja que la página lleve al login", async () => {
    const { deps: d, logged } = deps(null);
    await expect(checkRouteAccess(request("/panel/admin/empresas"), d)).resolves.toEqual({ allowed: true });
    expect(logged).toHaveLength(0);
  });

  it("si leer la sesión falla, la página vuelve a decidir", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d: RouteAccessDeps = {
      loadUser: async () => {
        throw new Error("base de datos caída");
      },
      logger: () => {},
    };
    await expect(checkRouteAccess(request("/panel/admin/empresas"), d)).resolves.toEqual({ allowed: true });
    error.mockRestore();
  });

  it("un fallo al registrar no cambia la respuesta 403", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d: RouteAccessDeps = {
      loadUser: async () => inspector,
      logger: () => {
        throw new Error("no se pudo escribir");
      },
    };
    await expect(checkRouteAccess(request("/panel/admin/empresas"), d)).resolves.toMatchObject({ allowed: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
