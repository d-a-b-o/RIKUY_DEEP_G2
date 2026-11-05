import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integración de HU19 contra Postgres: login, bloqueo por intentos, rate limit
 * y recuperación de contraseña, a través del handler HTTP real de /api/auth.
 */

const sentResetEmails: { to: string; url: string }[] = [];
vi.mock("./emails", () => ({
  sendPasswordResetEmail: async ({ to, url }: { to: string; url: string }) => {
    sentResetEmails.push({ to, url });
  },
}));

const PASSWORD = "Fundicion-2026";

describe.skipIf(!process.env.DATABASE_URL)("autenticación (HU19)", async () => {
  const { getDb } = await import("@/lib/db");
  const { getAuth } = await import("./server");
  const { createCredentialUser } = await import("./users");
  const { LOCK_MINUTES, MAX_FAILED_ATTEMPTS } = await import("./lockout");

  const db = getDb();
  const auth = getAuth();
  let companyId: string;
  const createdEmails: string[] = [];

  /** Cada prueba usa su propia IP para no compartir el rate limit. */
  let ip: string;
  beforeEach(() => {
    ip = `10.${rand()}.${rand()}.${rand()}`;
  });

  function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
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

  const signIn = (email: string, password: string) => call("/sign-in/email", { body: { email, password } });

  async function sessionOf(cookie: string) {
    const response = await call("/get-session", { method: "GET", cookie });
    return (await response.json()) as { user: { email: string; role: string } } | null;
  }

  function cookieFrom(response: Response): string {
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  }

  async function newUser(overrides: { active?: boolean } = {}) {
    const email = `hu19-${randomUUID()}@prueba.test`;
    createdEmails.push(email);
    const user = await createCredentialUser({ email, name: "Inspector de prueba", password: PASSWORD, role: "INSPECTOR", companyId });
    if (overrides.active === false) await db.user.update({ where: { id: user.id }, data: { active: false } });
    return user;
  }

  beforeAll(async () => {
    const company = await db.company.create({
      data: { name: "Empresa HU19", taxId: `2${String(Date.now()).slice(-10)}` },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await db.verification.deleteMany({ where: { identifier: { startsWith: "reset-password:" } } });
    await db.user.deleteMany({ where: { email: { in: createdEmails } } });
    await db.company.delete({ where: { id: companyId } });
  });

  describe("inicio de sesión", () => {
    it("con la contraseña correcta crea una sesión con el rol del usuario", async () => {
      const user = await newUser();
      const response = await signIn(user.email, PASSWORD);
      expect(response.status).toBe(200);

      const session = await sessionOf(cookieFrom(response));
      expect(session?.user).toMatchObject({ email: user.email, role: "INSPECTOR" });
    });

    it("con la contraseña incorrecta responde 401 y cuenta el intento", async () => {
      const user = await newUser();
      const response = await signIn(user.email, "otra-contraseña");
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });

      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(1);
    });

    it("un correo inexistente responde igual que una contraseña incorrecta", async () => {
      const response = await signIn(`nadie-${randomUUID()}@prueba.test`, PASSWORD);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    });

    it("un usuario desactivado no puede entrar", async () => {
      const user = await newUser({ active: false });
      const response = await signIn(user.email, PASSWORD);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    });

    it("un login correcto pone a cero los intentos fallidos", async () => {
      const user = await newUser();
      await signIn(user.email, "mal-1");
      await signIn(user.email, "mal-2");
      expect((await signIn(user.email, PASSWORD)).status).toBe(200);

      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(0);
    });
  });

  describe(`bloqueo tras ${MAX_FAILED_ATTEMPTS} intentos fallidos`, () => {
    it("el quinto fallo bloquea la cuenta, incluso con la contraseña correcta", async () => {
      const user = await newUser();
      for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
        expect((await signIn(user.email, `mal-${attempt}`)).status).toBe(401);
      }

      const fifth = await signIn(user.email, "mal-5");
      expect(fifth.status).toBe(401);
      expect(await fifth.json()).toMatchObject({ code: "ACCOUNT_LOCKED" });

      const withRightPassword = await signIn(user.email, PASSWORD);
      expect(withRightPassword.status).toBe(401);
      expect(await withRightPassword.json()).toMatchObject({ code: "ACCOUNT_LOCKED" });
      expect(withRightPassword.headers.getSetCookie()).toHaveLength(0);

      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      const minutes = (row.lockedUntil!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(LOCK_MINUTES - 1);
      expect(minutes).toBeLessThanOrEqual(LOCK_MINUTES);
    });

    it("al vencer el bloqueo se puede entrar y el contador vuelve a cero", async () => {
      const user = await newUser();
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: MAX_FAILED_ATTEMPTS, lockedUntil: new Date(Date.now() - 1000) },
      });

      expect((await signIn(user.email, PASSWORD)).status).toBe(200);
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it("un fallo después de un bloqueo vencido empieza a contar desde 1", async () => {
      const user = await newUser();
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: MAX_FAILED_ATTEMPTS, lockedUntil: new Date(Date.now() - 1000) },
      });

      expect((await signIn(user.email, "mal")).status).toBe(401);
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row).toMatchObject({ failedLoginCount: 1, lockedUntil: null });
    });
  });

  it("el rate limit corta los intentos seguidos desde una misma IP", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      statuses.push((await signIn(`nadie-${attempt}@prueba.test`, PASSWORD)).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  describe("recuperación de contraseña", () => {
    async function requestReset(email: string) {
      return call("/request-password-reset", { body: { email, redirectTo: "/restablecer" } });
    }

    function tokenOf(email: string): string {
      const sent = sentResetEmails.findLast((entry) => entry.to === email);
      if (!sent) throw new Error(`No se envió correo a ${email}`);
      return new URL(sent.url).searchParams.get("token")!;
    }

    it("responde lo mismo exista o no la cuenta, y solo envía correo si existe", async () => {
      const user = await newUser();
      const ghost = `nadie-${randomUUID()}@prueba.test`;

      const existing = await requestReset(user.email);
      const missing = await requestReset(ghost);
      expect(existing.status).toBe(200);
      expect(missing.status).toBe(200);
      expect(await existing.json()).toEqual(await missing.json());

      expect(sentResetEmails.some((entry) => entry.to === user.email)).toBe(true);
      expect(sentResetEmails.some((entry) => entry.to === ghost)).toBe(false);
    });

    it("el enlace lleva a /restablecer y vence en 30 minutos", async () => {
      const user = await newUser();
      await requestReset(user.email);
      const sent = sentResetEmails.findLast((entry) => entry.to === user.email)!;
      expect(new URL(sent.url).pathname).toBe("/restablecer");

      const verification = await db.verification.findFirstOrThrow({
        where: { identifier: `reset-password:${tokenOf(user.email)}` },
      });
      const minutes = (verification.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThanOrEqual(30);
    });

    it("cambiar la contraseña cierra las sesiones abiertas y el enlace no se puede reutilizar", async () => {
      const user = await newUser();
      const cookie = cookieFrom(await signIn(user.email, PASSWORD));
      expect(await sessionOf(cookie)).not.toBeNull();

      await requestReset(user.email);
      const token = tokenOf(user.email);
      const reset = await call("/reset-password", { body: { token, newPassword: "Nueva-clave-2026" } });
      expect(reset.status).toBe(200);

      expect(await sessionOf(cookie)).toBeNull();
      expect((await signIn(user.email, PASSWORD)).status).toBe(401);
      expect((await signIn(user.email, "Nueva-clave-2026")).status).toBe(200);

      const reused = await call("/reset-password", { body: { token, newPassword: "Otra-clave-2026" } });
      expect(reused.status).toBe(400);
      expect(await reused.json()).toMatchObject({ code: "INVALID_TOKEN" });
    });

    it("un enlace vencido no sirve", async () => {
      const user = await newUser();
      await requestReset(user.email);
      const token = tokenOf(user.email);
      await db.verification.updateMany({
        where: { identifier: `reset-password:${token}` },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await call("/reset-password", { body: { token, newPassword: "Nueva-clave-2026" } });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" });
    });

    it("restablecer la contraseña desbloquea la cuenta", async () => {
      const user = await newUser();
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: MAX_FAILED_ATTEMPTS, lockedUntil: new Date(Date.now() + 60_000) },
      });

      await requestReset(user.email);
      await call("/reset-password", { body: { token: tokenOf(user.email), newPassword: "Nueva-clave-2026" } });

      expect((await signIn(user.email, "Nueva-clave-2026")).status).toBe(200);
    });
  });
});

function rand(): number {
  return Math.floor(Math.random() * 250) + 1;
}
