const steps = [
  {
    title: "Instala la estación",
    body: "Fija una cámara sobre la cinta, conecta un computador y calibra la estación con la cinta vacía.",
  },
  {
    title: "Asigna el lote",
    body: "El supervisor asigna el lote a la estación. El turno se detecta solo por la hora.",
  },
  {
    title: "Inspección automática",
    body: "Cada pieza que pasa se detecta, se inspecciona una vez y queda registrada, sin intervención humana.",
  },
  {
    title: "Actúa y revisa",
    body: "Retira las piezas que la alerta marca, consulta el dashboard y descarga el reporte del turno.",
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="border-b border-border bg-acero-950 text-acero-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-colada-400">Cómo funciona</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            De la instalación al reporte del turno en cuatro pasos
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3 border-t-2 border-colada-400 pt-5">
              <span className="font-mono text-sm text-colada-300">Paso {index + 1}</span>
              <h3 className="text-lg font-semibold text-white">{step.title}</h3>
              <p className="leading-7 text-acero-200">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
