/**
 * Reglas de autenticación de HU19, compartidas por el servidor y las pantallas.
 * No importa nada del servidor: se puede usar desde componentes de cliente.
 */

/** Minutos de validez del enlace de recuperación (HU19, criterio 2). */
export const RESET_PASSWORD_TOKEN_MINUTES = 30;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/** Duración de la sesión: 8 horas, un turno de planta. Se renueva con el uso. */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 8;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

/** Límites por IP (RIKDP-134). Ventanas en segundos. */
export const AUTH_RATE_LIMITS = {
  default: { window: 60, max: 60 },
  "/sign-in/email": { window: 60, max: 10 },
  "/request-password-reset": { window: 15 * 60, max: 5 },
  "/reset-password": { window: 15 * 60, max: 10 },
} as const;

/** Código de error propio para una cuenta bloqueada por intentos fallidos. */
export const ACCOUNT_LOCKED = "ACCOUNT_LOCKED";

/** Rutas a las que se vuelve tras iniciar sesión. */
export const AFTER_SIGN_IN_PATH = "/panel";
export const SIGN_IN_PATH = "/ingresar";

/**
 * Valida el destino después del login: solo rutas internas, para que un enlace
 * como /ingresar?next=https://otro.sitio no sirva para redirigir fuera.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return AFTER_SIGN_IN_PATH;
  }
  return next;
}

type AuthError = { code?: string; status?: number } | null | undefined;

/** Traduce los errores de Better Auth a mensajes para el usuario. */
export function authErrorMessage(error: AuthError, flow: "sign-in" | "reset"): string {
  if (error?.status === 429) {
    return "Hiciste demasiados intentos seguidos desde este equipo. Espera unos minutos y vuelve a intentarlo.";
  }
  switch (error?.code) {
    case ACCOUNT_LOCKED:
      return "Tu cuenta está bloqueada temporalmente por varios intentos fallidos. Espera 15 minutos o restablece tu contraseña.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "El correo o la contraseña no son correctos.";
    case "INVALID_TOKEN":
      return "El enlace no es válido, ya se usó o venció. Pide uno nuevo.";
    case "PASSWORD_TOO_SHORT":
      return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    case "PASSWORD_TOO_LONG":
      return `La contraseña no puede tener más de ${MAX_PASSWORD_LENGTH} caracteres.`;
    default:
      return flow === "sign-in"
        ? "No pudimos iniciar sesión. Vuelve a intentarlo en unos minutos."
        : "No pudimos cambiar la contraseña. Vuelve a intentarlo en unos minutos.";
  }
}
