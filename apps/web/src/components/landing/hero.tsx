import { InspectionPreview } from "./inspection-preview";

export function Hero() {
  return (
    <section id="inicio" className="relative overflow-hidden border-b border-border">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
        <div className="flex flex-col gap-7">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
            Inspección automática con IA para fundición
          </p>
          <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Inspecciona el 100{"\u00a0"}% de tus piezas, no solo una muestra
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            RikuyDeep se instala sobre tu línea de producción con una cámara y un computador. Detecta cada pieza que
            pasa, la clasifica como OK o defectuosa en menos de un segundo y avisa al instante cuando encuentra un
            defecto.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="#demo"
              className="inline-flex h-12 items-center rounded-lg bg-accent px-6 font-semibold text-accent-foreground transition-opacity hover:opacity-90"
            >
              Solicitar demo
            </a>
            <a
              href="#como-funciona"
              className="inline-flex h-12 items-center rounded-lg border border-border bg-surface px-6 font-semibold text-foreground transition-colors hover:border-primary"
            >
              Ver cómo funciona
            </a>
          </div>
          <dl className="grid max-w-xl grid-cols-3 gap-4 border-t border-border pt-6">
            <div>
              <dt className="text-xs text-muted-foreground">Piezas inspeccionadas</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">100 %</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Defectuosas detectadas</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">98,3 %</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Por estación</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">60/min</dd>
            </div>
          </dl>
          <p className="-mt-3 text-xs text-muted-foreground">
            Detección medida en el conjunto de prueba: 115 de 117 impulsores defectuosos, con 99,0 % de exactitud.
            Cada estación está diseñada para hasta una pieza por segundo.
          </p>
        </div>
        <div className="flex min-w-0 justify-center lg:justify-end">
          <InspectionPreview />
        </div>
      </div>
    </section>
  );
}
