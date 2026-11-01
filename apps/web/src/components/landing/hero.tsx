import { InspectionPreview } from "./inspection-preview";

export function Hero() {
  return (
    <section id="inicio" className="relative overflow-hidden border-b border-border">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
        <div className="flex flex-col gap-7">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
            Inspección visual con IA para fundición
          </p>
          <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Detecta piezas defectuosas antes de que salgan de tu planta
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            RikuyDeep revisa cada pieza con la cámara de un computador y un modelo de visión que funciona en el
            navegador. Da el veredicto en menos de 2 segundos y guarda la evidencia por lote, turno y molde.
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
              <dt className="text-xs text-muted-foreground">Defectuosas detectadas</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">98,3 %</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Exactitud</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">99,0 %</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Hardware extra</dt>
              <dd className="mt-1 text-2xl font-semibold">Ninguno</dd>
            </div>
          </dl>
          <p className="-mt-3 text-xs text-muted-foreground">
            Resultados del modelo en el conjunto de prueba: 195 impulsores de fundición, de los que detectó 115 de
            117 defectuosos.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <InspectionPreview />
        </div>
      </div>
    </section>
  );
}
