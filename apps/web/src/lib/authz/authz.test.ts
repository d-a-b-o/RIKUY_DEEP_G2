import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorize,
  can,
  check,
  ForbiddenError,
  forbiddenResponse,
  PERMISSIONS,
  permissionsFor,
  requiredPermission,
  ROLES,
  setDeniedAccessLogger,
  type AuthzUser,
  type DeniedAccess,
} from "./index";

const superadmin: AuthzUser = { id: "u0", role: "SUPERADMIN", empresaId: null };
const admin: AuthzUser = { id: "u1", role: "ADMIN_PLANTA", empresaId: "emp-A" };
const inspector: AuthzUser = { id: "u2", role: "INSPECTOR", empresaId: "emp-A" };
const visor: AuthzUser = { id: "u3", role: "VISUALIZADOR", empresaId: "emp-A" };

describe("matriz de permisos", () => {
  it("define los cuatro roles de la HU32", () => {
    expect(ROLES).toEqual(["SUPERADMIN", "ADMIN_PLANTA", "INSPECTOR", "VISUALIZADOR"]);
  });

  it("el Superadmin tiene todos los permisos", () => {
    for (const p of PERMISSIONS) expect(can(superadmin, p)).toBe(true);
  });

  it.each([
    ["ADMIN_PLANTA", "usuarios:gestionar", true],
    ["ADMIN_PLANTA", "catalogos:gestionar", true],
    ["ADMIN_PLANTA", "empresas:gestionar", false],
    ["ADMIN_PLANTA", "modelos:gestionar", false],
    ["INSPECTOR", "inspecciones:crear", true],
    ["INSPECTOR", "veredictos:corregir", true],
    ["INSPECTOR", "catalogos:gestionar", false],
    ["INSPECTOR", "usuarios:gestionar", false],
    ["VISUALIZADOR", "dashboard:ver", true],
    ["VISUALIZADOR", "inspecciones:ver", true],
    ["VISUALIZADOR", "inspecciones:crear", false],
    ["VISUALIZADOR", "veredictos:corregir", false],
  ] as const)("%s → %s = %s", (role, permission, expected) => {
    const user: AuthzUser = { id: "x", role, empresaId: "emp-A" };
    expect(can(user, permission)).toBe(expected);
  });

  it("los permisos crecen de Visualizador a Superadmin", () => {
    const n = (r: (typeof ROLES)[number]) => permissionsFor(r).length;
    expect(n("VISUALIZADOR")).toBeLessThan(n("INSPECTOR"));
    expect(n("INSPECTOR")).toBeLessThan(n("ADMIN_PLANTA"));
    expect(n("ADMIN_PLANTA")).toBeLessThan(n("SUPERADMIN"));
  });
});

describe("check", () => {
  it("rechaza a un usuario sin sesión", () => {
    expect(check(null, "dashboard:ver")).toEqual({ allowed: false, reason: "NO_AUTENTICADO" });
  });

  it("rechaza un rol desconocido", () => {
    const raro = { id: "z", role: "HACKER", empresaId: "emp-A" } as unknown as AuthzUser;
    expect(check(raro, "dashboard:ver")).toEqual({ allowed: false, reason: "ROL_INVALIDO" });
  });

  it("impide actuar sobre recursos de otra empresa", () => {
    expect(check(admin, "catalogos:gestionar", { empresaId: "emp-B" })).toEqual({
      allowed: false,
      reason: "OTRA_EMPRESA",
    });
    expect(can(admin, "catalogos:gestionar", { empresaId: "emp-A" })).toBe(true);
  });

  it("el Superadmin puede actuar sobre cualquier empresa", () => {
    expect(can(superadmin, "usuarios:gestionar", { empresaId: "emp-B" })).toBe(true);
  });
});

describe("authorize", () => {
  let registros: DeniedAccess[];

  beforeEach(() => {
    registros = [];
    setDeniedAccessLogger((e) => {
      registros.push(e);
    });
  });

  it("no hace nada si el permiso existe", async () => {
    await expect(authorize(inspector, "inspecciones:crear")).resolves.toBeUndefined();
    expect(registros).toHaveLength(0);
  });

  it("lanza ForbiddenError con status 403 y registra el intento", async () => {
    const intento = authorize(visor, "catalogos:gestionar", { path: "/api/catalogos" });
    await expect(intento).rejects.toBeInstanceOf(ForbiddenError);
    await expect(intento).rejects.toMatchObject({ status: 403, reason: "SIN_PERMISO" });

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      userId: "u3",
      role: "VISUALIZADOR",
      permission: "catalogos:gestionar",
      reason: "SIN_PERMISO",
      empresaId: "emp-A",
      path: "/api/catalogos",
    });
    expect(registros[0].at).toBeInstanceOf(Date);
  });

  it("registra también los intentos sin sesión", async () => {
    await expect(authorize(null, "dashboard:ver")).rejects.toMatchObject({ reason: "NO_AUTENTICADO" });
    expect(registros[0]).toMatchObject({ userId: null, role: null });
  });

  it("sigue denegando aunque el registro falle", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setDeniedAccessLogger(() => {
      throw new Error("base de datos caída");
    });
    await expect(authorize(visor, "usuarios:gestionar")).rejects.toBeInstanceOf(ForbiddenError);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("forbiddenResponse devuelve un 403 JSON", async () => {
    const res = forbiddenResponse(new ForbiddenError("usuarios:gestionar", "SIN_PERMISO"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", permission: "usuarios:gestionar" });
  });
});

describe("requiredPermission", () => {
  it.each([
    ["/admin/usuarios", "usuarios:gestionar"],
    ["/admin/usuarios/123", "usuarios:gestionar"],
    ["/inspecciones/nueva", "inspecciones:crear"],
    ["/inspecciones/42", "inspecciones:ver"],
    ["/api/catalogos/piezas", "catalogos:gestionar"],
    ["/dashboard", "dashboard:ver"],
  ])("%s exige %s", (path, permission) => {
    expect(requiredPermission(path)).toBe(permission);
  });

  it("no confunde prefijos parecidos", () => {
    expect(requiredPermission("/dashboardx")).toBeNull();
  });

  it("las rutas públicas no exigen permiso", () => {
    expect(requiredPermission("/")).toBeNull();
    expect(requiredPermission("/login")).toBeNull();
  });
});
