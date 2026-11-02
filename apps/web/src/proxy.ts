import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Comprobación optimista de sesión para las rutas privadas: solo mira si hay
 * cookie, sin ir a la base de datos. La comprobación real la hace cada página
 * con getCurrentUser() (src/lib/auth/session.ts). Los permisos por rol van
 * aquí con HU32.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/ingresar", request.url);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/panel/:path*"],
};
