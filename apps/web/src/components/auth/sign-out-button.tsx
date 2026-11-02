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
      className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold transition-colors hover:border-primary disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
