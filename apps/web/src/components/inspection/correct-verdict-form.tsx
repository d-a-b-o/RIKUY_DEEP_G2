"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { correctInspection } from "@/app/panel/inspeccion/actions";
import { FormAlert } from "@/components/auth/fields";
import { VERDICT_LABELS } from "./labels";

/**
 * HU40-T01 (RIKDP-214): corregir el veredicto con motivo obligatorio. El
 * servidor guarda la corrección como evento nuevo, sin borrar el veredicto
 * original, y marca la imagen para reentrenamiento (HU40-T02).
 */
export function CorrectVerdictForm({
  inspectionId,
  currentVerdict,
}: {
  inspectionId: string;
  currentVerdict: "OK" | "DEFECTIVE";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const newVerdict = currentVerdict === "OK" ? "DEFECTIVE" : "OK";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
        if (reason.length < 3) {
          setError("Explica el motivo de la corrección (mínimo 3 caracteres).");
          return;
        }
        setError(null);
        startTransition(async () => {
          const result = await correctInspection({ inspectionId, newVerdict, reason });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setDone(`Veredicto corregido a ${VERDICT_LABELS[result.data.currentVerdict]}. La imagen quedó marcada para reentrenamiento.`);
          router.refresh();
        });
      }}
    >
      <FormAlert message={error} />
      {done ? (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm">
          {done}
        </p>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        El veredicto vigente es <strong>{VERDICT_LABELS[currentVerdict]}</strong>. Al corregirlo pasará a{" "}
        <strong>{VERDICT_LABELS[newVerdict]}</strong>. El original se conserva en la trazabilidad.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reason" className="text-sm font-medium">
          Motivo de la corrección
        </label>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={3}
          maxLength={500}
          rows={3}
          className="ui-input min-h-24 py-2"
          placeholder="Ej.: la mancha es reflejo de la luz, la pieza no tiene porosidad"
        />
      </div>
      <button type="submit" disabled={pending} className="ui-button self-start">
        {pending ? "Guardando…" : `Corregir a ${VERDICT_LABELS[newVerdict]}`}
      </button>
    </form>
  );
}
