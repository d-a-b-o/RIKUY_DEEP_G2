import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { getSiteUrl } from "@/lib/site";
import {
  ACCOUNT_LOCKED,
  AUTH_RATE_LIMITS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_TOKEN_MINUTES,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./config";
import { sendPasswordResetEmail } from "./emails";
import { getLockState, registerFailedLogin, resetFailedLogins } from "./lockout";

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
      },
    },
    hooks: {
      // Antes de comprobar la contraseña: cuentas bloqueadas o desactivadas.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = emailFromBody(ctx.body);
        if (!email) return;
        if ((await getLockState(email)).locked) throw lockedError();
        const user = await getDb().user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { active: true },
        });
        if (user && !user.active) {
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
    // Debe ir al final: guarda las cookies de sesión al llamar a auth.api desde el servidor.
    plugins: [nextCookies()],
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
