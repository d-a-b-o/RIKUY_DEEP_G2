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
    title: "Veredicto en menos de 2 segundos",
    body: "El inspector encuadra la pieza y ve al instante si está OK o defectuosa, con la confianza del modelo.",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2.5M9.5 2h5" />
      </svg>
    ),
  },
  {
    title: "Con la cámara que ya tienes",
    body: "Una webcam y un navegador. El modelo se ejecuta en el propio computador, sin servidores de IA ni equipos especiales.",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3" />
      </svg>
    ),
  },
  {
    title: "Trazabilidad que no se borra",
    body: "Cada inspección guarda foto, inspector, lote, turno, molde y versión del modelo. Las correcciones quedan registradas con su motivo.",
    icon: (
      <svg {...iconProps}>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M9 12h6M9 16h6M9 8h3" />
      </svg>
    ),
  },
  {
    title: "Dashboard y reporte de turno",
    body: "Piezas inspeccionadas, porcentaje de defectos y ranking de moldes problemáticos, con reporte en PDF y Excel.",
    icon: (
      <svg {...iconProps}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    title: "Cada planta con sus accesos",
    body: "Administradores, inspectores y visualizadores con permisos distintos. Los datos de una empresa nunca se mezclan con los de otra.",
    icon: (
      <svg {...iconProps}>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
  {
    title: "Mejora con cada corrección",
    body: "Cuando un inspector corrige un veredicto, la imagen se reserva para reentrenar el modelo y hacerlo más preciso con tus piezas.",
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
            Un segundo par de ojos que no se cansa y lo registra todo
          </h2>
          <p className="text-lg leading-8 text-muted-foreground">
            RikuyDeep no reemplaza a tu inspector: le da un criterio constante y deja evidencia de cada pieza.
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
