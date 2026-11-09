"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

type Props = {
  companyId: string;
  companyName: string;
  email: string;
  emailSent: boolean;
  inviteUrl?: string;
  showCompanyLink?: boolean;
};

/** Resultado de una invitación. Si el correo no salió, ofrece copiar el enlace. */
export function InvitationResult({ companyId, companyName, email, emailSent, inviteUrl, showCompanyLink }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div role="status" className="flex flex-col gap-4 rounded-xl border border-ok/40 bg-ok/5 p-5">
      <p className="flex items-start gap-3 font-medium">
        <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
        <span>
          {emailSent
            ? `Enviamos la invitación a ${email} para administrar ${companyName}.`
            : `Invitación creada para ${email}, pero el correo no se pudo enviar.`}
        </span>
      </p>
      {!emailSent && inviteUrl ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="enlace-invitacion" className="text-sm text-muted-foreground">
            Copia el enlace y envíaselo. Vence en 7 días y solo sirve una vez.
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="enlace-invitacion" readOnly value={inviteUrl} className="ui-input min-w-0 flex-1 font-mono text-xs" />
            <button type="button" onClick={copy} className="ui-button ui-button-secondary shrink-0">
              {copied ? "Copiado" : "Copiar enlace"}
            </button>
          </div>
        </div>
      ) : null}
      {showCompanyLink ? (
        <Link href={`/panel/admin/empresas/${companyId}`} className="ui-button self-start">
          Ver la empresa
          <Icon name="arrow" />
        </Link>
      ) : null}
    </div>
  );
}
