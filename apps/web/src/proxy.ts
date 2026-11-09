import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
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
export async function proxy(request: NextRequest) {
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

export const config = {
  matcher: ["/panel/:path*"],
};
