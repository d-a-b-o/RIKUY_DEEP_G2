import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcceptInvitationForm } from "@/components/auth/accept-invitation-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormAlert, submitClass } from "@/components/auth/fields";
import { ROLE_LABELS } from "@/lib/authz";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { previewInvitation, type InvitationStatus } from "@/lib/invitations/service";

export const metadata: Metadata = {
  title: "Aceptar invitación",
  robots: { index: false },
};

export default function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return (
    <AuthShell title="Crea tu cuenta" description="Te invitaron a usar RikuyDeep en tu planta.">
      <Suspense fallback={<p className="text-muted-foreground">Comprobando la invitación…</p>}>
        <Invitation searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

const PROBLEMS: Record<Exclude<InvitationStatus, "valid">, string> = {
  invalid: "El enlace no es válido. Pide a quien te invitó que te envíe uno nuevo.",
  expired: "La invitación venció. Pide a quien te invitó que te envíe una nueva.",
  used: "Esta invitación ya se usó. Si ya tienes cuenta, ingresa con tu correo.",
  company_inactive: "La empresa de esta invitación está desactivada.",
};

async function Invitation({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  // La validez depende de la hora actual: siempre en tiempo de petición.
  await connection();
  const value = typeof token === "string" ? token : "";
  const preview = isDatabaseConfigured() && value ? await previewInvitation(getDb(), value) : { status: "invalid" as const };

  if (preview.status !== "valid" || !preview.email) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert message={PROBLEMS[preview.status === "valid" ? "invalid" : preview.status]} />
        <Link href="/ingresar" className={submitClass}>
          Ir a ingresar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="leading-7 text-muted-foreground">
        Empresa: <strong className="text-foreground">{preview.companyName}</strong>
        {preview.role ? (
          <>
            {" "}
            · Rol: <strong className="text-foreground">{ROLE_LABELS[preview.role]}</strong>
          </>
        ) : null}
      </p>
      <AcceptInvitationForm token={value} email={preview.email} />
    </div>
  );
}
