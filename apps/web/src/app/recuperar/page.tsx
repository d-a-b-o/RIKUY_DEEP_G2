import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { RequestResetForm } from "@/components/auth/request-reset-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false },
};

export default function RequestResetPage() {
  return (
    <AuthShell
      title="Recuperar contraseña"
      description="Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una nueva."
      footer={
        <Link href="/ingresar" className="font-medium text-primary underline-offset-4 hover:underline">
          Volver a ingresar
        </Link>
      }
    >
      <RequestResetForm />
    </AuthShell>
  );
}
