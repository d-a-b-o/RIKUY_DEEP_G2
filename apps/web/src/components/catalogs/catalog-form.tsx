"use client";

import { useActionState } from "react";
import { catalogAction, type CatalogFormState } from "@/app/panel/catalogos/actions";
import { FormAlert } from "@/components/auth/fields";

const initialState: CatalogFormState = { status: "idle" };

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "time" | "number" | "select";
  options?: { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  maxLength?: number;
  min?: number;
  max?: number;
};

/**
 * Formulario de catálogo (HU31/HU33): campos simples, una intención y un
 * mensaje de resultado. Tras guardar, el formulario de alta se vacía.
 */
export function CatalogForm({
  intent,
  id,
  fields = [],
  hidden = {},
  submitLabel,
  variant = "primary",
  confirm,
  inline = false,
}: {
  intent: string;
  id?: string;
  fields?: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(catalogAction, initialState);
  const errors = state.status === "error" ? state.fields : {};
  const values = state.status === "error" ? state.values : {};
  const formKey = state.status === "saved" ? state.at : "form";
  const prefix = `${intent.replace(":", "-")}${id ? `-${id.slice(0, 8)}` : ""}`;
  const buttonClass =
    variant === "primary"
      ? "ui-button"
      : variant === "danger"
        ? "ui-button ui-button-secondary border-defect/60 text-defect"
        : "ui-button ui-button-secondary";

  return (
    <form
      key={formKey}
      action={formAction}
      noValidate
      className={inline ? "flex flex-col gap-2" : "flex flex-col gap-4"}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormAlert message={state.status === "error" && Object.keys(errors).length === 0 ? state.message : null} />
      {fields.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const fieldId = `${prefix}-${f.name}`;
            const error = errors[f.name];
            const describedBy = [f.hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null].filter(Boolean).join(" ") || undefined;
            const common = {
              id: fieldId,
              name: f.name,
              required: f.required,
              defaultValue: values[f.name] ?? f.defaultValue,
              "aria-invalid": Boolean(error),
              "aria-describedby": describedBy,
              className: "ui-input",
            };
            return (
              <div key={f.name} className="flex flex-col gap-1.5">
                <label htmlFor={fieldId} className="text-sm font-medium">
                  {f.label}
                </label>
                {f.type === "select" ? (
                  <select {...common}>
                    <option value="">Elige…</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input {...common} type={f.type ?? "text"} maxLength={f.maxLength} min={f.min} max={f.max} />
                )}
                {f.hint ? (
                  <p id={`${fieldId}-hint`} className="text-sm text-muted-foreground">
                    {f.hint}
                  </p>
                ) : null}
                {error ? (
                  <p id={`${fieldId}-error`} className="text-sm text-defect">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {state.status === "saved" && fields.length > 0 ? (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${buttonClass} self-start`}>
        {pending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
