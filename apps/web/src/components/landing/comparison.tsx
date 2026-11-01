type Rating = "good" | "mixed" | "poor";

type Row = {
  criterion: string;
  manual: [Rating, string];
  machineVision: [Rating, string];
  rikuy: [Rating, string];
};

const rows: Row[] = [
  {
    criterion: "Inversión inicial",
    manual: ["good", "Baja"],
    machineVision: ["poor", "Alta: cámaras industriales, iluminación e integrador"],
    rikuy: ["good", "Baja: webcam y computador"],
  },
  {
    criterion: "Puesta en marcha",
    manual: ["good", "Inmediata"],
    machineVision: ["poor", "Semanas o meses"],
    rikuy: ["good", "Días"],
  },
  {
    criterion: "Criterio constante",
    manual: ["poor", "Varía con la persona y el cansancio"],
    machineVision: ["good", "Sí"],
    rikuy: ["good", "Sí, el mismo modelo en todos los puestos"],
  },
  {
    criterion: "Evidencia de cada pieza",
    manual: ["poor", "No"],
    machineVision: ["mixed", "Depende del sistema"],
    rikuy: ["good", "Foto, veredicto, inspector y versión del modelo"],
  },
  {
    criterion: "Reportes por turno y molde",
    manual: ["poor", "Manuales, en planillas"],
    machineVision: ["mixed", "Según la integración"],
    rikuy: ["good", "Incluidos"],
  },
  {
    criterion: "Mejora con el uso",
    manual: ["mixed", "Con capacitación"],
    machineVision: ["mixed", "Reconfiguración por el integrador"],
    rikuy: ["good", "Reentrenamiento con tus correcciones"],
  },
];

const ratingLabel: Record<Rating, string> = { good: "Ventaja", mixed: "Parcial", poor: "Desventaja" };

function RatingIcon({ rating }: { rating: Rating }) {
  const common = { viewBox: "0 0 16 16", className: "mt-0.5 h-4 w-4 flex-none", "aria-hidden": true };
  if (rating === "good") {
    return (
      <svg {...common} className={`${common.className} text-ok`}>
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (rating === "mixed") {
    return (
      <svg {...common} className={`${common.className} text-warning`}>
        <path d="M3 8h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common} className={`${common.className} text-defect`}>
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Cell({ value, highlight = false }: { value: [Rating, string]; highlight?: boolean }) {
  const [rating, text] = value;
  return (
    <td className={`px-5 py-4 align-top ${highlight ? "bg-acero-50/60 dark:bg-acero-900/40" : ""}`}>
      <span className="flex gap-2">
        <RatingIcon rating={rating} />
        <span>
          <span className="sr-only">{ratingLabel[rating]}: </span>
          {text}
        </span>
      </span>
    </td>
  );
}

export function Comparison() {
  return (
    <section id="comparativa" className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-20 sm:px-6">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">Comparativa</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            La consistencia de la visión artificial, sin su costo de entrada
          </h2>
        </div>
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm leading-6">
            <caption className="sr-only">
              Comparación entre inspección manual, visión artificial tradicional y RikuyDeep
            </caption>
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="w-[22%] px-5 py-3 font-semibold">
                  Criterio
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Inspección manual
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Visión artificial tradicional
                </th>
                <th scope="col" className="bg-acero-50/60 px-5 py-3 font-semibold text-primary dark:bg-acero-900/40">
                  RikuyDeep
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.criterion}>
                  <th scope="row" className="px-5 py-4 align-top font-semibold">
                    {row.criterion}
                  </th>
                  <Cell value={row.manual} />
                  <Cell value={row.machineVision} />
                  <Cell value={row.rikuy} highlight />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
