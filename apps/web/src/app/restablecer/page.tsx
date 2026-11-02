import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Nueva contraseña",
  robots: { index: false },
  // El token va en la URL: que no se envíe a otros sitios como referrer.
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Nueva contraseña" description="Elige la contraseña con la que vas a ingresar desde ahora.">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
