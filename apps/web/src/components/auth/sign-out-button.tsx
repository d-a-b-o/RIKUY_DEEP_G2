"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace("/ingresar");
          router.refresh();
        })
      }
      className="ui-button ui-button-secondary"
    >
      {pending ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
