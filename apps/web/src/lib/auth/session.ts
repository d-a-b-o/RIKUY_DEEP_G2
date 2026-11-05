import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { SIGN_IN_PATH } from "./config";
import { getSession } from "./server";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  companyName: string | null;
};

/**
 * Usuario de la sesión actual para las páginas privadas (capa de acceso a datos).
 * Sin sesión válida, o con la cuenta desactivada, redirige al login.
 */
export async function getCurrentUser(nextPath: string): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) redirect(`${SIGN_IN_PATH}?next=${encodeURIComponent(nextPath)}`);

  const user = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, active: true, company: { select: { name: true } } },
  });
  if (!user?.active) redirect(SIGN_IN_PATH);

  return { id: user.id, name: user.name, email: user.email, role: user.role, companyName: user.company?.name ?? null };
}
