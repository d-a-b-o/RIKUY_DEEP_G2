"use client";

import { useActionState, useState } from "react";
import { inviteUserAction, type InviteState } from "@/app/panel/admin/usuarios/actions";
import { Field, FormAlert } from "@/components/auth/fields";

const initialState: InviteState = { status: "idle" };

/** HU30-T02 (RIKDP-172): invitar a un Inspector o Visualizador por correo. */
export function InviteUserForm() {
  const [state, formAction, pending] = useActionState(inviteUserAction, initialState);
  const [copied, setCopied] = useState(false);
  const errors = state.status === "error" ? state.fields : {};
  const values = state.status === "error" ? state.values : {};

  return (
    <div className="flex flex-col gap-4">
      {state.status === "invited" ? (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-ok/40 bg-ok/5 p-4 text-sm">
          <p className="font-medium">
            {state.emailSent
              ? `Enviamos la invitación a ${state.email}.`
              : `Invitación creada para ${state.email}, pero el correo no se pudo enviar.`}
          </p>
          {state.inviteUrl ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="enlace-invitacion-usuario" className="text-muted-foreground">
                Copia el enlace y envíaselo. Vence en 7 días y solo sirve una vez.
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="enlace-invitacion-usuario" readOnly value={state.inviteUrl} className="ui-input min-w-0 flex-1 font-mono text-xs" />
                <button
                  type="button"
                  className="ui-button ui-button-secondary shrink-0"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(state.inviteUrl!);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copiado" : "Copiar enlace"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <form key={state.status === "invited" ? state.at : "form"} action={formAction} noValidate className="flex flex-col gap-4">
        <FormAlert message={state.status === "error" && Object.keys(errors).length === 0 ? state.message : null} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="invite-name" label="Nombre" error={errors.name}>
            {(field) => <input {...field} name="name" defaultValue={values.name} className="ui-input" autoComplete="off" required />}
          </Field>
          <Field id="invite-email" label="Correo" error={errors.email}>
            {(field) => <input {...field} name="email" type="email" defaultValue={values.email} className="ui-input" autoComplete="off" required />}
          </Field>
          <Field id="invite-role" label="Rol" error={errors.role}>
            {(field) => (
              <select {...field} name="role" defaultValue={values.role ?? "INSPECTOR"} className="ui-input">
                <option value="INSPECTOR">Inspector</option>
                <option value="VIEWER">Visualizador</option>
              </select>
            )}
          </Field>
        </div>
        <button type="submit" disabled={pending} className="ui-button self-start">
          {pending ? "Enviando…" : "Enviar invitación"}
        </button>
      </form>
    </div>
  );
}
