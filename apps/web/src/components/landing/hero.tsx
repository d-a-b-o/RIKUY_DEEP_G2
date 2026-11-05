import { InspectionPreview } from "./inspection-preview";

export function Hero() {
  return (
    <section
      id="inicio"
      className="industrial-grid relative isolate overflow-hidden border-b border-border"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[700px] w-[700px] rounded-full bg-primary/5 blur-[120px]"
      />
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-5 pb-14 pt-14 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-20 lg:pt-20">
        <div className="flex flex-col gap-7">
          <p className="ui-eyebrow">Visión artificial para fundición</p>
          <h1 className="max-w-xl text-balance text-[2.65rem] font-semibold leading-[1.08] tracking-[-0.04em] sm:text-6xl lg:text-[3.8rem]">
            Inspecciona el 100{"\u00a0"}% de tus piezas,
            <span className="text-primary"> no solo una muestra.</span>
          </h1>
          <p className="max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            RikuyDeep se instala sobre tu línea de producción con una cámara y
            un computador. Detecta cada pieza que pasa, la clasifica como OK o
            defectuosa en menos de un segundo y avisa al instante cuando
            encuentra un defecto.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="#demo" className="ui-button">
              Solicitar demo <span aria-hidden="true">↗</span>
            </a>
            <a href="#como-funciona" className="ui-button ui-button-secondary">
              Ver cómo funciona
            </a>
          </div>
          <dl className="grid max-w-xl grid-cols-3 gap-3 border-t border-border pt-6 [&_dd]:font-mono [&_dd]:text-primary">
            <div>
              <dt className="text-xs text-muted-foreground">
                Piezas inspeccionadas
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                100 %
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Defectuosas detectadas
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                98,3 %
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Por estación</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                60/min
              </dd>
            </div>
          </dl>
          <p className="-mt-3 text-xs text-muted-foreground">
            Detección medida en el conjunto de prueba: 115 de 117 impulsores
            defectuosos, con 99,0 % de exactitud. Cada estación está diseñada
            para hasta una pieza por segundo.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:pl-2">
          <p className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Visión en acción</span>
            <span className="text-primary">01 / Inspección</span>
          </p>
          <InspectionPreview />
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-wide text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-primary"
            />
            Vista ilustrativa · El análisis ocurre en tu equipo
          </p>
        </div>
      </div>
    </section>
  );
}
