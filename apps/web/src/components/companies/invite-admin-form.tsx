"use client";

import { useActionState } from "react";
import { inviteAdminAction, type CompanyFormState } from "@/app/panel/admin/empresas/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { InvitationResult } from "./invitation-result";

const initialState: CompanyFormState = { status: "idle" };

/** Invita a otro administrador o reenvía la invitación a quien no la aceptó. */
export function InviteAdminForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(inviteAdminAction, initialState);
  const values = state.status === "invalid" || state.status === "error" ? state.values : {};
  const errors = state.status === "invalid" ? state.errors : {};

  return (
    <div className="flex flex-col gap-5">
      {state.status === "invited" ? <InvitationResult {...state} /> : null}
      <form action={formAction} noValidate className="flex flex-col gap-5" key={state.status === "invited" ? state.email : "form"}>
        <input type="hidden" name="companyId" value={companyId} />
        <FormAlert message={state.status === "error" ? state.message : null} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="adminName" label="Nombre" error={errors.adminName}>
            {(field) => <input {...field} defaultValue={values.adminName} className="ui-input" autoComplete="off" required />}
          </Field>
          <Field id="adminEmail" label="Correo" error={errors.adminEmail}>
            {(field) => (
              <input {...field} type="email" defaultValue={values.adminEmail} className="ui-input" autoComplete="off" required />
            )}
          </Field>
        </div>
        <button type="submit" className="ui-button ui-button-secondary self-start" disabled={pending}>
          {pending ? "Enviando…" : "Enviar invitación"}
        </button>
      </form>
    </div>
  );
}
