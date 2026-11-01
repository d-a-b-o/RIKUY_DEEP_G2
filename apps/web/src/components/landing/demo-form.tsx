"use client";

import { useActionState, useSyncExternalStore } from "react";
import { requestDemo, type DemoRequestState } from "@/app/actions/request-demo";
import type { DemoRequestField } from "@/lib/leads/schema";

const initialState: DemoRequestState = { status: "idle" };

// Momento en que se cargó la página en el navegador, para el filtro anti-spam.
// Se lee con useSyncExternalStore: vale "" en el servidor y no se pierde cuando
// React reinicia el formulario después de cada envío.
const pageLoadedAt = typeof window === "undefined" ? "" : String(Date.now());
const subscribeNoop = () => () => {};
const getPageLoadedAt = () => pageLoadedAt;
const getServerPageLoadedAt = () => "";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring aria-[invalid=true]:border-defect";

type FieldProps = {
  id: Exclude<DemoRequestField, "consent">;
  label: string;
  optional?: boolean;
  error?: string;
  children: (props: { id: string; name: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
};

function Field({ id, label, optional, error, children }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
      </label>
      {children({ id, name: id, "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined })}
      {error ? (
        <p id={errorId} className="text-sm text-defect">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function DemoForm() {
  const [state, formAction, pending] = useActionState(requestDemo, initialState);
  const startedAt = useSyncExternalStore(subscribeNoop, getPageLoadedAt, getServerPageLoadedAt);

  const errors = state.status === "invalid" ? state.errors : {};
  const values = state.status === "invalid" || state.status === "unavailable" ? state.values : {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Nombre y apellido" error={errors.name}>
          {(props) => (
            <input {...props} type="text" autoComplete="name" required defaultValue={values.name} className={inputClass} />
          )}
        </Field>
        <Field id="email" label="Correo de trabajo" error={errors.email}>
          {(props) => (
            <input
              {...props}
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="nombre@empresa.com"
              defaultValue={values.email}
              className={inputClass}
            />
          )}
        </Field>
        <Field id="company" label="Empresa" error={errors.company}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="organization"
              required
              defaultValue={values.company}
              className={inputClass}
            />
          )}
        </Field>
        <Field id="role" label="Cargo" optional error={errors.role}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="organization-title"
              placeholder="Jefe de calidad"
              defaultValue={values.role}
              className={inputClass}
            />
          )}
        </Field>
        <Field id="phone" label="Teléfono" optional error={errors.phone}>
          {(props) => (
            <input
              {...props}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+51 987 654 321"
              defaultValue={values.phone}
              className={inputClass}
            />
          )}
        </Field>
      </div>

      <Field id="message" label="¿Qué piezas inspeccionan?" optional error={errors.message}>
        {(props) => (
          <textarea
            {...props}
            rows={4}
            placeholder="Por ejemplo: impulsores de bomba en aluminio, unas 2000 piezas por turno."
            defaultValue={values.message}
            className={inputClass}
          />
        )}
      </Field>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            name="consent"
            defaultChecked={values.consent}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={errors.consent ? "consent-error" : undefined}
            className="mt-1 h-4 w-4 flex-none accent-[var(--color-primary)]"
          />
          <span>Acepto que RikuyDeep use estos datos para contactarme sobre la demo.</span>
        </label>
        {errors.consent ? (
          <p id="consent-error" className="text-sm text-defect">
            {errors.consent}
          </p>
        ) : null}
      </div>

      <div aria-hidden="true" className="sr-only">
        <label htmlFor="website">Deja este campo vacío</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input type="hidden" name="startedAt" value={startedAt} readOnly />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center justify-center rounded-lg bg-accent px-6 font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Enviando…" : "Solicitar demo"}
        </button>
        <p className="text-xs leading-5 text-muted-foreground">Los campos sin «(opcional)» son obligatorios.</p>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {state.status === "invalid" ? (
          <p className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect">
            Revisa los campos marcados y vuelve a enviar.
          </p>
        ) : null}
        {state.status === "unavailable" ? (
          <p className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
            Tus datos están completos, pero el envío de solicitudes todavía no está activo en este sitio, así que no
            se ha guardado nada. Vuelve a intentarlo en unos días.
          </p>
        ) : null}
        {state.status === "rejected" ? (
          <p className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect">
            No pudimos procesar el envío. Recarga la página, espera unos segundos y vuelve a intentarlo.
          </p>
        ) : null}
      </div>
    </form>
  );
}
