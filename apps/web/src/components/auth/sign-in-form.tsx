"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage, safeNextPath } from "@/lib/auth/config";
import { Field, FormAlert, inputClass, submitClass } from "./fields";

type Errors = { email?: string; password?: string };

export function SignInForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const found: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) found.email = "Escribe un correo válido.";
    if (!password) found.password = "Escribe tu contraseña.";
    setErrors(found);
    setAlert(null);
    if (found.email || found.password) return;

    startTransition(async () => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        setAlert(authErrorMessage(error, "sign-in"));
        return;
      }
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Field id="email" label="Correo" error={errors.email}>
        {(props) => (
          <input {...props} type="email" autoComplete="username" inputMode="email" required className={inputClass} />
        )}
      </Field>
      <Field id="password" label="Contraseña" error={errors.password}>
        {(props) => <input {...props} type="password" autoComplete="current-password" required className={inputClass} />}
      </Field>
      <div className="-mt-2 text-right text-sm">
        <Link href="/recuperar" className="font-medium text-primary underline-offset-4 hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>
      <FormAlert message={alert} />
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
