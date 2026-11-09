import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { decodeBase32 } from "../../../e2e/support/totp";

/**
 * Integración de HU29 (RIKDP-40) contra Postgres, a través del handler HTTP
 * real de /api/auth: activación con verificación del primer código, login en
 * dos pasos, códigos de respaldo de un solo uso y 2FA obligatoria.
 */
const PASSWORD = "Fundicion-2026";

describe.skipIf(!process.env.DATABASE_URL)("verificación en dos pasos (HU29)", async () => {
  const { getDb } = await import("@/lib/db");
  const { getAuth } = await import("./server");
  const { createCredentialUser } = await import("./users");
  const { loadActor } = await import("@/lib/inspections/service");

  const db = getDb();
  const auth = getAuth();
  let companyId: string;
  const emails: string[] = [];

  let ip: string;
  const octet = () => Math.floor(Math.random() * 250) + 1;
  beforeEach(() => {
    ip = `10.${octet()}.${octet()}.${octet()}`;
  });

  function call(path: string, init: { body?: unknown; cookie?: string; method?: string } = {}) {
    const headers = new Headers({ origin: "http://localhost:3000", "x-forwarded-for": ip });
    if (init.body) headers.set("content-type", "application/json");
    if (init.cookie) headers.set("cookie", init.cookie);
    return auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: init.method ?? "POST",
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
      }),
    );
  }

  /** Une las cookies nuevas con las que ya había, como haría el navegador. */
  function cookies(response: Response, previous = ""): string {
    const jar = new Map(
      previous
        .split("; ")
        .filter(Boolean)
        .map((pair) => [pair.split("=")[0], pair] as const),
    );
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0];
      const name = pair.split("=")[0];
      if (/max-age=0/i.test(header) || pair.endsWith("=")) jar.delete(name);
      else jar.set(name, pair);
    }
    return [...jar.values()].join("; ");
  }

  const hasSession = (cookie: string) => cookie.includes("session_token=");

  async function newUser(role: "INSPECTOR" | "ADMIN" | "SUPERADMIN" = "INSPECTOR") {
    const email = `hu29-${randomUUID()}@prueba.test`;
    emails.push(email);
    return createCredentialUser({
      email,
      name: "Usuario HU29",
      password: PASSWORD,
      role,
      companyId: role === "SUPERADMIN" ? null : companyId,
    });
  }

  async function signIn(email: string) {
    const response = await call("/sign-in/email", { body: { email, password: PASSWORD } });
    return { response, body: (await response.json()) as Record<string, unknown>, cookie: cookies(response) };
  }

  function codeFor(totpURI: string): Promise<string> {
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    return createOTP(decodeBase32(secret)).totp();
  }

  /** Activa la 2FA de punta a punta y devuelve lo necesario para los casos. */
  async function enableFor(email: string) {
    const login = await signIn(email);
    const enable = await call("/two-factor/enable", { body: { password: PASSWORD }, cookie: login.cookie });
    expect(enable.status).toBe(200);
    const data = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    const verify = await call("/two-factor/verify-totp", { body: { code: await codeFor(data.totpURI) }, cookie: login.cookie });
    expect(verify.status).toBe(200);
    return { ...data, cookie: cookies(verify, login.cookie) };
  }

  beforeAll(async () => {
    const company = await db.company.create({ data: { name: "Empresa HU29" } });
    companyId = company.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.company.delete({ where: { id: companyId } });
  });

  it("la activación pide la contraseña y no queda activa hasta verificar el primer código", async () => {
    const user = await newUser();
    const login = await signIn(user.email);

    const wrongPassword = await call("/two-factor/enable", { body: { password: "otra-clave-000" }, cookie: login.cookie });
    expect(wrongPassword.status).toBe(400);

    const enable = await call("/two-factor/enable", { body: { password: PASSWORD }, cookie: login.cookie });
    const data = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    expect(data.totpURI).toMatch(/^otpauth:\/\/totp\/RikuyDeep:/);
    expect(data.backupCodes).toHaveLength(10);
    expect(new Set(data.backupCodes).size).toBe(10);

    let saved = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { twoFactor: true } });
    expect(saved.twoFactorEnabled).toBe(false);
    expect(saved.twoFactor?.verified).toBe(false);
    // El secreto y los códigos se guardan cifrados.
    expect(saved.twoFactor?.secret).not.toContain(new URL(data.totpURI).searchParams.get("secret"));
    expect(saved.twoFactor?.backupCodes).not.toContain(data.backupCodes[0]);

    const bad = await call("/two-factor/verify-totp", { body: { code: "000000" }, cookie: login.cookie });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { code: string }).code).toBe("INVALID_CODE");

    const ok = await call("/two-factor/verify-totp", { body: { code: await codeFor(data.totpURI) }, cookie: login.cookie });
    expect(ok.status).toBe(200);
    saved = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { twoFactor: true } });
    expect(saved.twoFactorEnabled).toBe(true);
    expect(saved.twoFactor?.verified).toBe(true);
  });

  it("con 2FA activa, la contraseña sola no crea sesión: hace falta el código", async () => {
    const user = await newUser();
    const { totpURI } = await enableFor(user.email);

    const login = await signIn(user.email);
    expect(login.body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(hasSession(login.cookie)).toBe(false);

    const wrong = await call("/two-factor/verify-totp", { body: { code: "123456" }, cookie: login.cookie });
    expect(wrong.status).toBe(401);

    const right = await call("/two-factor/verify-totp", { body: { code: await codeFor(totpURI) }, cookie: login.cookie });
    expect(right.status).toBe(200);
    const session = cookies(right, login.cookie);
    expect(hasSession(session)).toBe(true);
    const me = await call("/get-session", { method: "GET", cookie: session });
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(user.email);
  });

  it("cada código de respaldo sirve una sola vez", async () => {
    const user = await newUser();
    const { backupCodes } = await enableFor(user.email);

    const first = await signIn(user.email);
    const use = await call("/two-factor/verify-backup-code", { body: { code: backupCodes[0] }, cookie: first.cookie });
    expect(use.status).toBe(200);
    expect(hasSession(cookies(use, first.cookie))).toBe(true);

    const second = await signIn(user.email);
    const reuse = await call("/two-factor/verify-backup-code", { body: { code: backupCodes[0] }, cookie: second.cookie });
    expect(reuse.status).toBe(401);
    expect(((await reuse.json()) as { code: string }).code).toBe("INVALID_BACKUP_CODE");

    const other = await call("/two-factor/verify-backup-code", { body: { code: backupCodes[1] }, cookie: second.cookie });
    expect(other.status).toBe(200);
  });

  it("regenerar los códigos invalida los anteriores", async () => {
    const user = await newUser();
    const { backupCodes, cookie } = await enableFor(user.email);
    const regen = await call("/two-factor/generate-backup-codes", { body: { password: PASSWORD }, cookie });
    expect(regen.status).toBe(200);
    const fresh = ((await regen.json()) as { backupCodes: string[] }).backupCodes;
    expect(fresh).toHaveLength(10);

    const login = await signIn(user.email);
    const old = await call("/two-factor/verify-backup-code", { body: { code: backupCodes[2] }, cookie: login.cookie });
    expect(old.status).toBe(401);
  });

  it("una cuenta con 2FA opcional puede desactivarla", async () => {
    const user = await newUser();
    const { cookie } = await enableFor(user.email);
    const disable = await call("/two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(disable.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(false);
    expect(await db.twoFactor.count({ where: { userId: user.id } })).toBe(0);
  });

  it("el superadministrador no puede desactivarla", async () => {
    const user = await newUser("SUPERADMIN");
    const { cookie } = await enableFor(user.email);
    const disable = await call("/two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(disable.status).toBe(403);
    expect(((await disable.json()) as { code: string }).code).toBe("TWO_FACTOR_REQUIRED");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(true);
  });

  it("si la empresa la exige, nadie puede desactivarla y sin activarla no se registran inspecciones", async () => {
    const withTwoFactor = await newUser();
    const { cookie } = await enableFor(withTwoFactor.email);
    const without = await newUser();
    expect(await loadActor(db, without.id)).not.toBeNull();

    await db.company.update({ where: { id: companyId }, data: { requireTwoFactor: true } });
    try {
      const disable = await call("/two-factor/disable", { body: { password: PASSWORD }, cookie });
      expect(disable.status).toBe(403);
      expect(await loadActor(db, without.id)).toBeNull();
      expect(await loadActor(db, withTwoFactor.id)).not.toBeNull();
    } finally {
      await db.company.update({ where: { id: companyId }, data: { requireTwoFactor: false } });
    }
  });
});
