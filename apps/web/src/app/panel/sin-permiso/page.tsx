import type { Metadata } from "next";
import { PanelShell } from "@/components/panel/panel-shell";
import { Forbidden } from "@/components/panel/forbidden";

export const metadata: Metadata = {
  title: "Sin permiso",
  robots: { index: false },
};

/**
 * Aviso de acceso denegado (HU32-T02). src/proxy.ts reescribe aquí, con estado
 * 403, las rutas del panel que el rol de la sesión no puede usar; la URL que ve
 * el usuario no cambia.
 */
export default function ForbiddenPage() {
  return (
    <PanelShell>
      <Forbidden />
    </PanelShell>
  );
}
