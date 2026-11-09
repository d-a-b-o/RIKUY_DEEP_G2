"use client";

import { useActionState } from "react";
import { setCompanyStatusAction, type StatusState } from "@/app/panel/admin/empresas/actions";
import { FormAlert } from "@/components/auth/fields";

const initialState: StatusState = { status: "idle" };

/** Activa o desactiva la empresa (HU23, criterio 3). Desactivar pide confirmación. */
export function StatusToggle({ companyId, status }: { companyId: string; status: "ACTIVE" | "INACTIVE" }) {
  const [state, formAction, pending] = useActionState(setCompanyStatusAction, initialState);
  const deactivate = status === "ACTIVE";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        if (
          deactivate &&
          !window.confirm("¿Desactivar la empresa? Sus usuarios no podrán iniciar sesión y se cerrarán sus sesiones abiertas.")
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="status" value={deactivate ? "INACTIVE" : "ACTIVE"} />
      <FormAlert message={state.status === "error" ? state.message : null} />
      {state.status === "saved" ? (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm">
          {state.message}
        </p>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        {deactivate
          ? "Al desactivarla, nadie de esta empresa podrá iniciar sesión y se cerrarán las sesiones abiertas. Sus datos se conservan."
          : "La empresa está desactivada. Al activarla, sus usuarios podrán volver a iniciar sesión."}
      </p>
      <button
        type="submit"
        disabled={pending}
        className={`ui-button self-start ${deactivate ? "ui-button-secondary border-defect/60 text-defect" : ""}`}
      >
        {pending ? "Guardando…" : deactivate ? "Desactivar empresa" : "Activar empresa"}
      </button>
    </form>
  );
}
