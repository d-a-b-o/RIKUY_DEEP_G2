/**
 * Se ejecuta una vez al arrancar el servidor de Next.js.
 *
 * HU32-T03 (RIKDP-181): instala el registrador que guarda los accesos denegados
 * en access_denied_log. Sin base de datos (p. ej. en `next build`) se mantiene
 * el registrador por consola.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;

  const [{ setDeniedAccessLogger }, { createDbDeniedAccessLogger }, { getDb }] = await Promise.all([
    import("@/lib/authz"),
    import("@/lib/authz/denied-log"),
    import("@/lib/db"),
  ]);
  setDeniedAccessLogger(createDbDeniedAccessLogger(getDb));
}
