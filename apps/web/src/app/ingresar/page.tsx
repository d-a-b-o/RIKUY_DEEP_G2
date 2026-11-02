import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Ingresar",
  robots: { index: false },
};

export default function SignInPage() {
  return (
    <AuthShell
      title="Ingresar"
      description="Usa el correo y la contraseña de tu cuenta de planta."
      footer="¿No tienes cuenta? Pídesela al administrador de tu planta."
    >
      {/* El formulario lee ?next= de la URL, que solo se conoce en cada petición. */}
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
