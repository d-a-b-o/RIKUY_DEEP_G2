"use client";

import { useActionState } from "react";
import {
  createCompanyAction,
  updateCompanyAction,
  type CompanyFormState,
  type CompanyFormValues,
} from "@/app/panel/admin/empresas/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { COMPANY_TIMEZONES } from "@/lib/companies/schema";
import { InvitationResult } from "./invitation-result";

const initialState: CompanyFormState = { status: "idle" };

type Props =
  | { mode: "create" }
  | { mode: "edit"; companyId: string; defaults: { name: string; taxId: string | null; timezone: string } };

/** Alta o edición de una empresa (HU23-T01). En el alta también se invita al administrador. */
export function CompanyForm(props: Props) {
  const [state, formAction, pending] = useActionState(
    props.mode === "create" ? createCompanyAction : updateCompanyAction,
    initialState,
  );

  if (state.status === "invited") {
    return <InvitationResult {...state} showCompanyLink />;
  }

  const values: CompanyFormValues =
    state.status === "invalid" || state.status === "error"
      ? state.values
      : props.mode === "edit"
        ? { name: props.defaults.name, taxId: props.defaults.taxId ?? "", timezone: props.defaults.timezone }
        : { timezone: "America/Lima" };
  const errors = state.status === "invalid" ? state.errors : {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {props.mode === "edit" ? <input type="hidden" name="companyId" value={props.companyId} /> : null}
      <FormAlert message={state.status === "error" ? state.message : null} />
      {state.status === "saved" ? (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm">
          {state.message}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 font-semibold">Datos de la empresa</legend>
        <Field id="name" label="Nombre" error={errors.name}>
          {(field) => (
            <input {...field} defaultValue={values.name} className="ui-input" autoComplete="organization" required />
          )}
        </Field>
        <Field id="taxId" label="RUC (opcional)" hint="11 dígitos, sin espacios." error={errors.taxId}>
          {(field) => <input {...field} defaultValue={values.taxId} className="ui-input" inputMode="numeric" maxLength={11} />}
        </Field>
        <Field id="timezone" label="Zona horaria" hint="Define el horario de los turnos de la planta." error={errors.timezone}>
          {(field) => (
            <select {...field} defaultValue={values.timezone} className="ui-input">
              {COMPANY_TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("America/", "").replace("_", " ")}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      {props.mode === "create" ? (
        <fieldset className="flex flex-col gap-5 border-t border-border pt-5">
          <legend className="mb-1 font-semibold">Administrador de la planta</legend>
          <p className="-mt-2 text-sm text-muted-foreground">
            Le enviaremos un correo para que cree su cuenta y elija su contraseña.
          </p>
          <Field id="adminName" label="Nombre" error={errors.adminName}>
            {(field) => <input {...field} defaultValue={values.adminName} className="ui-input" autoComplete="off" required />}
          </Field>
          <Field id="adminEmail" label="Correo" error={errors.adminEmail}>
            {(field) => (
              <input {...field} type="email" defaultValue={values.adminEmail} className="ui-input" autoComplete="off" required />
            )}
          </Field>
        </fieldset>
      ) : null}

      <button type="submit" className="ui-button self-start" disabled={pending}>
        {pending ? "Guardando…" : props.mode === "create" ? "Crear empresa e invitar" : "Guardar cambios"}
      </button>
    </form>
  );
}
