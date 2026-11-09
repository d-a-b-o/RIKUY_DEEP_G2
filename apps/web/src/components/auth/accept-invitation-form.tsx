"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptInvitationAction, type AcceptInvitationState } from "@/app/invitacion/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/config";
import { Field, FormAlert, inputClass, submitClass } from "./fields";

const initialState: AcceptInvitationState = { status: "idle" };

export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, initialState);

  if (state.status === "accepted") {
    return (
      <div role="status" className="flex flex-col gap-4">
        <p className="font-semibold">Cuenta creada</p>
        <p className="leading-7 text-muted-foreground">Ya puedes ingresar con {state.email} y la contraseña que elegiste.</p>
        <Link href="/ingresar" className={submitClass}>
          Ir a ingresar
        </Link>
      </div>
    );
  }

  const errors = state.status === "invalid" ? state.errors : {};
  const name = state.status === "invalid" || state.status === "error" ? state.name : "";

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <FormAlert message={state.status === "error" ? state.message : null} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Correo</span>
        <p className="break-all rounded-lg border border-border bg-surface px-3 py-2 text-sm">{email}</p>
      </div>
      <Field id="name" label="Tu nombre" error={errors.name}>
        {(field) => <input {...field} defaultValue={name} className={inputClass} autoComplete="name" required />}
      </Field>
      <Field
        id="password"
        label="Contraseña"
        hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres.`}
        error={errors.password}
      >
        {(field) => <input {...field} type="password" className={inputClass} autoComplete="new-password" required />}
      </Field>
      <Field id="confirm" label="Repite la contraseña" error={errors.confirm}>
        {(field) => <input {...field} type="password" className={inputClass} autoComplete="new-password" required />}
      </Field>
      <button type="submit" className={submitClass} disabled={pending}>
        {pending ? "Creando tu cuenta…" : "Crear mi cuenta"}
      </button>
    </form>
  );
}
