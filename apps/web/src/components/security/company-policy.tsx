"use client";

import { useActionState } from "react";
import { setCompanyTwoFactorPolicyAction, type PolicyState } from "@/app/panel/cuenta/seguridad/actions";
import { FormAlert } from "@/components/auth/fields";

const initialState: PolicyState = { status: "idle" };

/** El administrador de planta exige 2FA a toda su empresa (HU29, criterio 3). */
export function CompanyPolicy({ companyName, required }: { companyName: string; required: boolean }) {
  const [state, formAction, pending] = useActionState(setCompanyTwoFactorPolicyAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="requireTwoFactor" value={required ? "" : "on"} />
      <p className="text-sm leading-6 text-muted-foreground">
        {required
          ? `En ${companyName} todas las personas deben usar la verificación en dos pasos. Quien no la tenga activada deberá configurarla al entrar.`
          : `En ${companyName} la verificación en dos pasos es opcional. Si la exiges, quien no la tenga deberá activarla al entrar.`}
      </p>
      <FormAlert message={state.status === "error" ? state.message : null} />
      {state.status === "saved" ? (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`ui-button self-start ${required ? "ui-button-secondary" : ""}`}>
        {pending ? "Guardando…" : required ? "Dejar de exigirla" : "Exigir a toda la planta"}
      </button>
    </form>
  );
}
