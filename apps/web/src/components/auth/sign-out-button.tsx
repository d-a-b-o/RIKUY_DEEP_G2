"use client";

import { useTransition } from "react";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          // Navegación completa: descarta la caché del router con las páginas de la sesión.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- se busca justo una carga completa
          window.location.assign("/ingresar");
        })
      }
      className="ui-button ui-button-secondary"
    >
      {pending ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
