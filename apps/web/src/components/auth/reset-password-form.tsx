"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth/client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, authErrorMessage } from "@/lib/auth/config";
import { Field, FormAlert, inputClass, submitClass } from "./fields";

type Errors = { password?: string; confirm?: string };

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert message="Este enlace no es válido. Pide uno nuevo desde «¿Olvidaste tu contraseña?»." />
        <Link href="/recuperar" className={submitClass}>
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <p className="font-semibold">Contraseña actualizada</p>
        <p className="leading-7 text-muted-foreground">
          Cerramos todas tus sesiones abiertas por seguridad. Ingresa con tu nueva contraseña.
        </p>
        <Link href="/ingresar" className={submitClass}>
          Ir a ingresar
        </Link>
      </div>
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    const found: Errors = {};
    if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    } else if (password.length > MAX_PASSWORD_LENGTH) {
      found.password = `Usa como máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
    }
    if (confirm !== password) found.confirm = "Las contraseñas no coinciden.";
    setErrors(found);
    setAlert(null);
    if (found.password || found.confirm) return;

    startTransition(async () => {
      const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
      if (error) {
        setAlert(authErrorMessage(error, "reset"));
        return;
      }
      setDone(true);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Field
        id="password"
        label="Nueva contraseña"
        hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres. Una frase es más fácil de recordar.`}
        error={errors.password}
      >
        {(props) => <input {...props} type="password" autoComplete="new-password" required className={inputClass} />}
      </Field>
      <Field id="confirm" label="Repite la contraseña" error={errors.confirm}>
        {(props) => <input {...props} type="password" autoComplete="new-password" required className={inputClass} />}
      </Field>
      <FormAlert message={alert} />
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
