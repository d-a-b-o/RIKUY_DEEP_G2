import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { getSiteUrl } from "@/lib/site";
import {
  ACCOUNT_LOCKED,
  AUTH_RATE_LIMITS,
  BACKUP_CODES_AMOUNT,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_TOKEN_MINUTES,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  TRUST_DEVICE_DAYS,
  TWO_FACTOR_REQUIRED,
  TWO_FACTOR_ISSUER,
  TWO_FACTOR_LOCK_MINUTES,
  TWO_FACTOR_MAX_FAILED_ATTEMPTS,
} from "./config";
import { sendPasswordResetEmail } from "./emails";
import { getLockState, registerFailedLogin, resetFailedLogins } from "./lockout";
import { isTwoFactorRequired } from "./two-factor-policy";

const SIGN_IN_PATH = "/sign-in/email";

/**
 * 401 con código propio. Es el mismo estado que una contraseña incorrecta porque,
 * cuando el error sale del hook posterior, Better Auth conserva el estado original.
 */
function lockedError(): APIError {
  return new APIError("UNAUTHORIZED", {
    code: ACCOUNT_LOCKED,
    message: "Cuenta bloqueada temporalmente por intentos fallidos",
  });
}

function emailFromBody(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

/**
 * Quien tiene 2FA obligatoria (superadmin o empresa que la exige) no puede
 * desactivarla (HU29, criterio 3). La interfaz oculta el botón; esto es la defensa real.
 */
async function assertTwoFactorOptional(ctx: Parameters<typeof getSessionFromCtx>[0]): Promise<void> {
  const session = await getSessionFromCtx(ctx);
  if (!session) return;
  const user = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: { role: true, company: { select: { requireTwoFactor: true } } },
  });
  if (user && isTwoFactorRequired(user)) {
    throw new APIError("FORBIDDEN", {
      code: TWO_FACTOR_REQUIRED,
      message: "La verificación en dos pasos es obligatoria para esta cuenta",
    });
  }
}

function createAuth() {
  return betterAuth({
    appName: "RikuyDeep",
    database: prismaAdapter(getDb(), { provider: "postgresql", transaction: true }),
    // En Vercel cada preview tiene su propia URL; se acepta cualquiera del proyecto.
    baseURL: {
      allowedHosts: ["localhost:*", "127.0.0.1:*", "*.vercel.app", getSiteUrl().host],
      fallback: getSiteUrl().origin,
    },
    emailAndPassword: {
      enabled: true,
      // Las cuentas las crea un administrador por invitación (HU23, HU30).
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // Enlace directo a nuestra pantalla; el token se valida al enviarlo.
        const url = new URL("/restablecer", getSiteUrl());
        url.searchParams.set("token", token);
        await sendPasswordResetEmail({ to: user.email, name: user.name, url: url.toString() });
      },
      onPasswordReset: async ({ user }) => {
        await resetFailedLogins({ userId: user.id });
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    user: {
      additionalFields: {
        role: { type: "string", input: false },
        companyId: { type: "string", required: false, input: false },
        active: { type: "boolean", input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: AUTH_RATE_LIMITS.default.window,
      max: AUTH_RATE_LIMITS.default.max,
      customRules: {
        "/sign-in/email": AUTH_RATE_LIMITS["/sign-in/email"],
        "/request-password-reset": AUTH_RATE_LIMITS["/request-password-reset"],
        "/reset-password": AUTH_RATE_LIMITS["/reset-password"],
        "/two-factor/*": AUTH_RATE_LIMITS["/two-factor/*"],
      },
    },
    hooks: {
      // Antes de comprobar la contraseña: cuentas bloqueadas, desactivadas o de empresas desactivadas.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/two-factor/disable") {
          await assertTwoFactorOptional(ctx);
          return;
        }
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = emailFromBody(ctx.body);
        if (!email) return;
        if ((await getLockState(email)).locked) throw lockedError();
        const user = await getDb().user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { active: true, company: { select: { status: true } } },
        });
        // Cuenta o empresa desactivada (HU23, criterio 3). Mismo error que una
        // contraseña incorrecta, para no revelar qué cuentas existen.
        if (user && (!user.active || user.company?.status === "INACTIVE")) {
          throw new APIError("UNAUTHORIZED", {
            code: "INVALID_EMAIL_OR_PASSWORD",
            message: "Invalid email or password",
          });
        }
      }),
      // Después: cuenta el fallo o pone el contador a cero.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = emailFromBody(ctx.body);
        if (!email) return;
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          if (returned.body?.code !== "INVALID_EMAIL_OR_PASSWORD") return;
          // El quinto fallo ya responde con el bloqueo.
          if ((await registerFailedLogin(email)).locked) throw lockedError();
          return;
        }
        await resetFailedLogins({ email });
      }),
    },
    plugins: [
      // HU29: TOTP con app autenticadora y códigos de respaldo. El secreto y los
      // códigos se guardan cifrados con BETTER_AUTH_SECRET.
      twoFactor({
        issuer: TWO_FACTOR_ISSUER,
        trustDeviceMaxAge: TRUST_DEVICE_DAYS * 24 * 60 * 60,
        backupCodeOptions: { amount: BACKUP_CODES_AMOUNT, length: 10, storeBackupCodes: "encrypted" },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: TWO_FACTOR_MAX_FAILED_ATTEMPTS,
          durationSeconds: TWO_FACTOR_LOCK_MINUTES * 60,
        },
      }),
      // Debe ir al final: guarda las cookies de sesión al llamar a auth.api desde el servidor.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { auth?: Auth };

/**
 * Instancia de Better Auth. Se crea al primer uso y no al importar el módulo,
 * para que `next build` no necesite la base de datos ni BETTER_AUTH_SECRET.
 */
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth();
  return globalForAuth.auth;
}

export type Session = Auth["$Infer"]["Session"];

/** Sesión de la petición actual, o null. */
export async function getSession(): Promise<Session | null> {
  // headers() primero: en el prerender suspende aquí, antes de crear la instancia.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}
