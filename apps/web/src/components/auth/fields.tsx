export const inputClass = "ui-input";

export const submitClass = "ui-button w-full";

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => React.ReactNode;
};

/** Campo con etiqueta, ayuda y error accesibles. */
export function Field({ id, label, error, hint, children }: FieldProps) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        name: id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-defect">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Mensaje de error del formulario, anunciado por los lectores de pantalla. */
export function FormAlert({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-defect/40 bg-defect/5 px-4 py-3 text-sm text-defect"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
