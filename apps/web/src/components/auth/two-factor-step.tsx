"use client";

import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage, TRUST_DEVICE_DAYS } from "@/lib/auth/config";
import { Field, FormAlert, inputClass, submitClass } from "./fields";

type Props = { onVerified: () => void; onCancel: () => void };

/** Segundo paso del login (HU29): código de la app autenticadora o código de respaldo. */
export function TwoFactorStep({ onVerified, onCancel }: Props) {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = data.get("trustDevice") === "on";

    setAlert(null);
    if (mode === "totp" && !/^\d{6}$/.test(code)) {
      setError("Escribe los 6 dígitos que muestra tu app.");
      return;
    }
    if (mode === "backup" && code.length < 6) {
      setError("Escribe uno de tus códigos de respaldo.");
      return;
    }
    setError(undefined);

    startTransition(async () => {
      const { error: failure } =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
          : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
      if (failure) {
        setAlert(authErrorMessage(failure, "two-factor"));
        return;
      }
      onVerified();
    });
  }

  const totp = mode === "totp";
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-labelledby="segundo-paso">
      <div>
        <h2 id="segundo-paso" className="text-lg font-semibold">
          Verificación en dos pasos
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {totp
            ? "Abre tu app autenticadora y escribe el código de 6 dígitos de RikuyDeep."
            : "Escribe uno de los códigos de respaldo que guardaste. Cada uno sirve una sola vez."}
        </p>
      </div>
      <Field id="code" label={totp ? "Código de verificación" : "Código de respaldo"} error={error}>
        {(props) => (
          <input
            {...props}
            key={mode}
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode={totp ? "numeric" : "text"}
            maxLength={totp ? 6 : 32}
            className={`${inputClass} font-mono tracking-widest`}
          />
        )}
      </Field>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="trustDevice" className="mt-1 h-4 w-4 accent-[var(--primary)]" />
        <span>
          Confiar en este equipo durante {TRUST_DEVICE_DAYS} días
          <span className="block text-muted-foreground">No lo marques en equipos compartidos.</span>
        </span>
      </label>
      <FormAlert message={alert} />
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Verificando…" : "Verificar"}
      </button>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <button
          type="button"
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setMode(totp ? "backup" : "totp");
            setError(undefined);
            setAlert(null);
          }}
        >
          {totp ? "Usar un código de respaldo" : "Usar la app autenticadora"}
        </button>
        <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={onCancel}>
          Volver
        </button>
      </div>
    </form>
  );
}
