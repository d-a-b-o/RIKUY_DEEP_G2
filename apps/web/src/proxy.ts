import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, NextRequest } from "next/server";
import { applicationOrigins, contentSecurityPolicy, isSameOriginMutation, isUnsafeMethod } from "@/lib/security/policy";
import { consumeWriteLimit, writeLimitKey, writePolicy } from "@/lib/security/write-limit";
import { isDatabaseConfigured } from "@/lib/db";
import { checkRouteAccess, type RouteAccess } from "@/lib/authz/route-access";

/**
 * Proxy de Next.js 16 (antes middleware) para /panel.
 *
 * 1. Sin cookie de sesión → al login (comprobación optimista, sin base de datos).
 * 2. Ruta con permiso en la matriz (src/lib/authz/routes.ts) → se comprueba el rol
 *    de la sesión. Si no alcanza, el intento se registra y se responde 403
 *    (HU32-T02/T03): la página del aviso en las navegaciones, JSON en el resto.
 *
 * Las páginas y las server actions vuelven a comprobar el permiso: el proxy es
 * la primera barrera, no la única.
 */
async function panelProxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!getSessionCookie(request)) {
    const signIn = new URL("/ingresar", request.url);
    signIn.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  const access: RouteAccess = await checkRouteAccess({
    pathname,
    method: request.method,
    headers: request.headers,
  });
  if (access.allowed) return NextResponse.next();

  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.json({ error: "forbidden", permission: access.permission }, { status: 403 });
  }
  const forbiddenUrl = new URL(access.forbiddenPath, request.url);
  // Navegaciones dentro de la app (RSC, prefetch): el router de Next espera su
  // propio formato, así que se reescribe sin tocar el estado.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) {
    return NextResponse.rewrite(forbiddenUrl);
  }
  // Petición de documento: Next.js ignora el estado en NextResponse.rewrite, así
  // que se pide la página del aviso y se devuelve con 403. La URL no cambia.
  try {
    const forwarded = new Headers({ accept: "text/html" });
    for (const name of ["cookie", "accept-language", "user-agent"]) {
      const value = request.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    const page = await fetch(forbiddenUrl, { headers: forwarded, cache: "no-store" });
    const headers = new Headers(page.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(request.method === "HEAD" ? null : page.body, { status: 403, headers });
  } catch (error) {
    console.error("[proxy] no se pudo cargar la página de acceso denegado", error);
    return new Response("Acceso denegado", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

/** All writes pass through this boundary, including progressively enhanced forms. */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const forwarded = new Headers(request.headers);
  // Never reflect an inbound CSP/nonce supplied by the caller.
  forwarded.set("content-security-policy", csp);
  forwarded.set("x-nonce", nonce);
  const nextRequest = new NextRequest(request, { headers: forwarded });
  let response: Response;
  if (isUnsafeMethod(request.method)) {
    if (!isSameOriginMutation(request.headers, applicationOrigins())) {
      response = NextResponse.json({ error: "CSRF_REJECTED" }, { status: 403 });
    } else if (!request.nextUrl.pathname.startsWith("/api/auth/")) {
      if (!isDatabaseConfigured()) {
        response = NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
      } else {
        try {
          const policy = writePolicy(request.nextUrl.pathname);
          const decision = await consumeWriteLimit(writeLimitKey(request.headers, policy), policy);
          response = decision.allowed ? await dispatch(nextRequest, forwarded) : NextResponse.json(
            { error: "TOO_MANY_REQUESTS", message: "Demasiadas solicitudes. Espera antes de volver a intentar." },
            { status: 429, headers: { "Retry-After": String(decision.retryAfter) } },
          );
        } catch {
          // A storage failure must never disable the limit.
          response = NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
        }
      }
    } else {
      response = await dispatch(nextRequest, forwarded);
    }
  } else {
    response = await dispatch(nextRequest, forwarded);
  }
  response.headers.set("content-security-policy", response.headers.get("content-security-policy") ?? csp);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

async function dispatch(request: NextRequest, forwarded: Headers): Promise<Response> {
  if (request.nextUrl.pathname === "/panel" || request.nextUrl.pathname.startsWith("/panel/")) {
    const response = await panelProxy(request);
    // Preserve nonce headers for Next's document/RSC rendering and rewrites.
    if (response.headers.has("x-middleware-next") || response.headers.has("x-middleware-rewrite")) {
      const downstream = response.headers.get("x-middleware-rewrite");
      return downstream ? NextResponse.rewrite(new URL(downstream), { request: { headers: forwarded } })
        : NextResponse.next({ request: { headers: forwarded } });
    }
    return response;
  }
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|tfjs-wasm/).*)"],
};
