import type { ReactNode } from "react";

type Feature = { title: string; body: string; icon: ReactNode };

const iconProps = {
  viewBox: "0 0 24 24",
  className: "h-6 w-6",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const features: Feature[] = [
  {
    title: "Cada pieza, todo el turno",
    body: "Una estación sobre la línea detecta cada pieza que pasa y la inspecciona una vez, sin que nadie tenga que capturarla.",
    icon: (
      <svg {...iconProps}>
        <path d="M2 17h20M5 17l1.5-4h11l1.5 4" />
        <rect x="9" y="5" width="6" height="5" rx="1" />
        <path d="M12 10v3" />
      </svg>
    ),
  },
  {
    title: "Alerta inmediata",
    body: "Si una pieza es defectuosa, la pantalla se pone en rojo y suena un aviso hasta que un operario la retira.",
    icon: (
      <svg {...iconProps}>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    ),
  },
  {
    title: "Con hardware común",
    body: "Una cámara y un computador con navegador. El modelo se ejecuta en el propio equipo, sin servidores de IA ni equipos de visión industrial.",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3" />
      </svg>
    ),
  },
  {
    title: "Trazabilidad de cada pieza",
    body: "Todas las piezas quedan registradas con su veredicto, lote, turno, molde y versión del modelo, con foto de cada defectuosa y de una muestra de las OK.",
    icon: (
      <svg {...iconProps}>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M9 12h6M9 16h6M9 8h3" />
      </svg>
    ),
  },
  {
    title: "Dashboard y reporte de turno",
    body: "Piezas inspeccionadas, porcentaje de defectos por estación y ranking de moldes problemáticos, con reporte en PDF y Excel.",
    icon: (
      <svg {...iconProps}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    title: "Mejora con cada corrección",
    body: "Cuando alguien corrige un veredicto, la imagen se reserva para reentrenar el modelo y hacerlo más preciso con tus piezas.",
    icon: (
      <svg {...iconProps}>
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </svg>
    ),
  },
];

export function Solution() {
  return (
    <section id="solucion" className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">La solución</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Una estación que inspecciona cada pieza que pasa
          </h2>
          <p className="text-lg leading-8 text-muted-foreground">
            Trabaja como un inspector que no se cansa: revisa cada pieza con el mismo criterio de principio a fin del turno, y libera a tu equipo para decidir qué hacer con los defectos.
          </p>
        </div>
        <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title} className="flex flex-col gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-acero-50 text-primary dark:bg-acero-900">
                {feature.icon}
              </span>
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="leading-7 text-muted-foreground">{feature.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
