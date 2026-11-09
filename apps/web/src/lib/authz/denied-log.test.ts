import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeniedAccess } from "./authorize";
import { ACTION_METHOD, hashIp, parseDeniedAction, toDeniedAccessRow } from "./denied-log";

/** HU32-T03 · Registro de accesos denegados (RIKDP-181). */

const entry = (overrides: Partial<DeniedAccess> = {}): DeniedAccess => ({
  userId: "u3",
  role: "VIEWER",
  permission: "catalogos:gestionar",
  reason: "SIN_PERMISO",
  empresaId: "emp-A",
  path: "/panel/catalogos",
  method: "get",
  ip: "200.48.1.10",
  at: new Date(),
  ...overrides,
});

describe("toDeniedAccessRow", () => {
  it("guarda quién, dónde, qué permiso faltó y por qué", () => {
    expect(toDeniedAccessRow(entry(), "secreto")).toMatchObject({
      userId: "u3",
      companyId: "emp-A",
      method: "GET",
      path: "/panel/catalogos",
      action: "catalogos:gestionar · SIN_PERMISO",
    });
  });

  it("no guarda la IP, solo un hash con la clave del servidor", () => {
    const row = toDeniedAccessRow(entry(), "secreto");
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.ipHash).not.toContain("200.48");
    expect(row.ipHash).toBe(hashIp("200.48.1.10", "secreto"));
    expect(hashIp("200.48.1.10", "otro-secreto")).not.toBe(row.ipHash);
  });

  it("sin método es una server action y sin IP no hay hash", () => {
    const row = toDeniedAccessRow(entry({ method: undefined, ip: null, path: undefined }), "secreto");
    expect(row.method).toBe(ACTION_METHOD);
    expect(row.ipHash).toBeNull();
    expect(row.path).toBe("(sin ruta)");
  });

  it("parseDeniedAction recupera el permiso y el motivo", () => {
    expect(parseDeniedAction(toDeniedAccessRow(entry(), "s").action)).toEqual({
      permission: "catalogos:gestionar",
      reason: "SIN_PERMISO",
    });
    expect(parseDeniedAction("texto libre")).toEqual({ permission: null, reason: null });
    expect(parseDeniedAction(null)).toEqual({ permission: null, reason: null });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("access_denied_log en Postgres (HU32-T03)", async () => {
  const { getDb } = await import("@/lib/db");
  const { authorize, ForbiddenError, setDeniedAccessLogger } = await import("./authorize");
  const { createDbDeniedAccessLogger, listDeniedAccesses } = await import("./denied-log");
  type AuthzUser = import("./authorize").AuthzUser;

  const db = getDb();
  const companyIds: string[] = [];
  const userIds: string[] = [];
  let superadmin: AuthzUser;
  let adminA: AuthzUser;
  let viewerA: AuthzUser;
  let viewerB: AuthzUser;

  async function company(name: string) {
    const c = await db.company.create({ data: { name: `${name} ${randomUUID().slice(0, 6)}`, timezone: "America/Lima" } });
    companyIds.push(c.id);
    return c.id;
  }

  async function user(role: AuthzUser["role"], empresaId: string | null): Promise<AuthzUser> {
    const u = await db.user.create({
      data: { id: randomUUID(), name: `${role} HU32`, email: `hu32-${randomUUID()}@prueba.test`, role, companyId: empresaId },
    });
    userIds.push(u.id);
    return { id: u.id, role, empresaId };
  }

  beforeAll(async () => {
    const a = await company("Planta A");
    const b = await company("Planta B");
    superadmin = await user("SUPERADMIN", null);
    adminA = await user("ADMIN", a);
    viewerA = await user("VIEWER", a);
    viewerB = await user("VIEWER", b);
    setDeniedAccessLogger(createDbDeniedAccessLogger(() => db, "secreto-de-prueba"));
  });

  afterAll(async () => {
    setDeniedAccessLogger(() => {});
    await db.accessDeniedLog.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { userId: { in: userIds } }] } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.company.deleteMany({ where: { id: { in: companyIds } } });
  });

  it("authorize guarda el intento denegado en la tabla", async () => {
    await expect(
      authorize(viewerA, "usuarios:gestionar", { path: "/panel/admin/usuarios", method: "GET", ip: "10.0.0.7" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const rows = await db.accessDeniedLog.findMany({ where: { userId: viewerA.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: viewerA.empresaId,
      method: "GET",
      path: "/panel/admin/usuarios",
      action: "usuarios:gestionar · SIN_PERMISO",
    });
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("el Admin de planta ve solo los intentos de su empresa", async () => {
    await expect(authorize(viewerB, "catalogos:gestionar", { path: "crearPieza" })).rejects.toBeInstanceOf(ForbiddenError);

    const seen = await listDeniedAccesses(db, adminA, { limit: 200 });
    expect(seen.some((e) => e.userEmail && e.path === "/panel/admin/usuarios")).toBe(true);
    expect(seen.some((e) => e.path === "crearPieza")).toBe(false);
    const mine = seen.find((e) => e.path === "/panel/admin/usuarios");
    expect(mine).toMatchObject({ permission: "usuarios:gestionar", reason: "SIN_PERMISO", method: "GET" });
  });

  it("el Superadmin ve los de todas las empresas, con su nombre", async () => {
    const seen = await listDeniedAccesses(db, superadmin, { limit: 200 });
    const otra = seen.find((e) => e.path === "crearPieza");
    expect(otra).toMatchObject({ method: ACTION_METHOD, permission: "catalogos:gestionar" });
    expect(otra?.companyName).toMatch(/^Planta B/);
  });

  it("un Visualizador no puede consultar el registro, y ese intento también queda registrado", async () => {
    await expect(listDeniedAccesses(db, viewerA)).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await db.accessDeniedLog.findMany({ where: { userId: viewerA.id, action: { startsWith: "auditoria:ver" } } });
    expect(rows).toHaveLength(1);
  });

  it("si el usuario ya no existe, el intento se guarda sin él", async () => {
    const ghost: AuthzUser = { id: randomUUID(), role: "VIEWER", empresaId: adminA.empresaId };
    await expect(authorize(ghost, "usuarios:gestionar", { path: "fantasma" })).rejects.toBeInstanceOf(ForbiddenError);
    const row = await db.accessDeniedLog.findFirst({ where: { path: "fantasma", companyId: adminA.empresaId } });
    expect(row).toMatchObject({ userId: null });
  });
});
