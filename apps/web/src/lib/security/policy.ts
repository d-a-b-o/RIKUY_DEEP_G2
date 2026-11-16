/** HU48: pure policy shared by the proxy, auth configuration and tests. */
type Env = Record<string, string | undefined>;

function origin(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Origen de seguridad inválido");
  }
  return url.origin;
}

export function applicationOrigins(env: Env = process.env): string[] {
  const values = [env.NEXT_PUBLIC_SITE_URL, ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((host) => `https://${host}`)];
  if (!env.VERCEL && !values.some(Boolean)) values.push("http://localhost:3000");
  return [...new Set(values.filter((value): value is string => Boolean(value)).map(origin))];
}

export function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function isSameOriginMutation(headers: Headers, allowed: string[]): boolean {
  if (headers.get("sec-fetch-site") === "cross-site") return false;
  const value = headers.get("origin");
  if (!value) return false;
  try {
    const url = new URL(value);
    return value === url.origin && !url.username && !url.password && allowed.includes(url.origin);
  } catch {
    return false;
  }
}

export function contentSecurityPolicy(nonce: string, env: Env = process.env): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) throw new Error("Nonce inválido");
  const dev = env.NODE_ENV === "development";
  const connections = ["'self'", "blob:", ...[env.NEXT_PUBLIC_MODEL_MANIFEST_URL, env.R2_ENDPOINT_URL]
    .filter((value): value is string => Boolean(value)).map(origin)];
  if (dev) connections.push("ws:", "wss:");
  return [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'",
    `connect-src ${[...new Set(connections)].join(" ")}`,
    `img-src 'self' data: blob:${env.R2_ENDPOINT_URL ? " " + origin(env.R2_ENDPOINT_URL) : ""}`,
    "font-src 'self'", "worker-src 'self' blob:", "media-src 'self' blob:",
  ].join("; ");
}

export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];
