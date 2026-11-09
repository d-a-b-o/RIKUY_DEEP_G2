import Link from "next/link";
import { Icon } from "@/components/ui/icon";

/** Aviso de acceso denegado (HU32): la página existe, pero tu rol no puede usarla. */
export function Forbidden() {
  return (
    <section
      aria-labelledby="sin-permiso"
      className="ui-card flex flex-col items-start gap-4 p-6 sm:p-9"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/10 text-warning">
        <Icon name="shield" className="h-6 w-6" />
      </span>
      <h2 id="sin-permiso" className="text-xl font-semibold">
        Esta sección no está disponible para tu rol
      </h2>
      <p className="max-w-xl leading-7 text-muted-foreground">
        Si crees que deberías tener acceso, pídeselo al administrador de tu
        planta.
      </p>
      <Link href="/panel" className="ui-button">
        Volver al inicio
      </Link>
    </section>
  );
}
