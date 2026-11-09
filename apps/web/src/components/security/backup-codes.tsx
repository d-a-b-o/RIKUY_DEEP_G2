"use client";

import { useState } from "react";

/** Muestra los códigos de respaldo una sola vez, con copiar y descargar (HU29, criterio 2). */
export function BackupCodes({ codes }: { codes: readonly string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob(
      [`Códigos de respaldo de RikuyDeep\nCada código sirve una sola vez.\n\n${text}\n`],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rikuydeep-codigos-de-respaldo.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-warning/40 bg-warning/5 p-5">
      <div>
        <h3 className="font-semibold">Guarda tus códigos de respaldo</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Si pierdes el móvil, cada código te deja entrar una vez. No volverán a mostrarse.
        </p>
      </div>
      <ul aria-label="Códigos de respaldo" className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
        {codes.map((code) => (
          <li key={code} className="rounded-md border border-border bg-surface px-2 py-1.5 text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copy} className="ui-button ui-button-secondary">
          {copied ? "Copiados" : "Copiar códigos"}
        </button>
        <button type="button" onClick={download} className="ui-button ui-button-secondary">
          Descargar .txt
        </button>
      </div>
    </div>
  );
}
