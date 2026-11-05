"use client";

import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth/client";
import { RESET_PASSWORD_TOKEN_MINUTES, authErrorMessage } from "@/lib/auth/config";
import { Field, FormAlert, inputClass, submitClass } from "./fields";

export function RequestResetForm() {
  const [error, setError] = useState<string>();
  const [alert, setAlert] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setAlert(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Escribe un correo válido.");
      return;
    }
    setError(undefined);

    startTransition(async () => {
      const { error: requestError } = await authClient.requestPasswordReset({ email, redirectTo: "/restablecer" });
      if (requestError) {
        setAlert(authErrorMessage(requestError, "reset"));
        return;
      }
      setSentTo(email);
    });
  }

  if (sentTo) {
    // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="font-semibold">Revisa tu correo</p>
        <p className="leading-7 text-muted-foreground">
          Si <strong className="font-medium text-foreground">{sentTo}</strong> tiene una cuenta en RikuyDeep, te
          enviamos un enlace para elegir una nueva contraseña. Vence en {RESET_PASSWORD_TOKEN_MINUTES} minutos y solo
          sirve una vez.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Field id="email" label="Correo" error={error}>
        {(props) => (
          <input {...props} type="email" autoComplete="email" inputMode="email" required className={inputClass} />
        )}
      </Field>
      <FormAlert message={alert} />
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Enviando…" : "Enviar enlace"}
      </button>
    </form>
  );
}
