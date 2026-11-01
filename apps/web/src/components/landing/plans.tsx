type Plan = {
  name: string;
  audience: string;
  features: string[];
  featured?: boolean;
};

const plans: Plan[] = [
  {
    name: "Piloto",
    audience: "Para validar RikuyDeep con tus propias piezas en una línea.",
    features: [
      "Una planta y una línea de inspección",
      "Inspección con cámara, por lote e imagen subida",
      "Historial y trazabilidad de cada pieza",
      "Acompañamiento en la puesta en marcha",
    ],
  },
  {
    name: "Planta",
    audience: "Para inspeccionar toda la producción de una planta.",
    features: [
      "Todo lo del plan Piloto",
      "Varias líneas e inspectores",
      "Dashboard de calidad y reporte de turno en PDF y Excel",
      "Inspección en video en tiempo real",
      "Corrección de veredictos y reentrenamiento del modelo",
    ],
    featured: true,
  },
  {
    name: "Corporativo",
    audience: "Para grupos con varias plantas y requisitos de seguridad propios.",
    features: [
      "Todo lo del plan Planta",
      "Varias plantas con datos aislados",
      "Verificación en dos pasos obligatoria",
      "Soporte prioritario",
    ],
  },
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 flex-none text-ok" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Plans() {
  return (
    <section id="planes" className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">Planes</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Empieza con una línea y crece a tu ritmo</h2>
          <p className="text-lg leading-8 text-muted-foreground">
            El precio depende del volumen de piezas que inspeccionas. Solicita una demo y te enviamos una propuesta.
          </p>
        </div>
        <ul className="grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <li
              key={plan.name}
              className={`flex flex-col gap-6 rounded-2xl border bg-background p-7 ${
                plan.featured ? "border-primary shadow-lg shadow-acero-900/10" : "border-border"
              }`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {plan.featured ? (
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                      Recomendado
                    </span>
                  ) : null}
                </div>
                <p className="leading-7 text-muted-foreground">{plan.audience}</p>
              </div>
              <ul className="flex flex-1 flex-col gap-3 text-sm leading-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#demo"
                className={`inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-opacity hover:opacity-90 ${
                  plan.featured
                    ? "bg-accent text-accent-foreground"
                    : "border border-border bg-surface text-foreground hover:border-primary"
                }`}
              >
                Pedir propuesta
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
