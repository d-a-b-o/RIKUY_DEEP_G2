import { DemoForm } from "./demo-form";

const expectations = [
  "Una videollamada de 30 minutos con tu equipo de calidad",
  "Una inspección en vivo con imágenes de piezas como las tuyas",
  "Una evaluación de dónde instalar la estación en tu línea",
  "Una propuesta según tu volumen de producción",
];

export function DemoSection() {
  return (
    <section id="demo" className="border-b border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col gap-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">Solicitar demo</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Míralo funcionar con tus piezas</h2>
          <p className="text-lg leading-8 text-muted-foreground">Cuéntanos qué fabricas y te contactamos para coordinar.</p>
          <ul className="flex flex-col gap-3 pt-2">
            {expectations.map((item) => (
              <li key={item} className="flex gap-3 leading-7">
                <span className="mt-2.5 h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <DemoForm />
        </div>
      </div>
    </section>
  );
}
