const problems = [
  {
    title: "Se revisa una muestra, no todo",
    body: "Cuando la producción no da tiempo para mirar cada pieza, se inspecciona una de cada cierta cantidad. Los defectos que caen entre muestra y muestra salen de la planta.",
  },
  {
    title: "El criterio cambia con el cansancio",
    body: "Un inspector revisa cientos de piezas por turno. A la sexta hora, un poro pequeño o una rebaba se escapan con más facilidad que a la primera.",
  },
  {
    title: "El defecto aparece en el cliente",
    body: "El veredicto se anota en una planilla, sin foto. La pieza que se escapó vuelve como devolución o penalidad, y no hay forma de saber en qué lote ni turno pasó.",
  },
];

export function Problem() {
  return (
    <section id="problema" className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent">El problema</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Revisar una muestra deja pasar defectos
          </h2>
          <p className="text-lg leading-8 text-muted-foreground">
            En la mayoría de plantas de fundición, la calidad final depende de una persona que revisa lo que alcanza
            al final de la línea.
          </p>
        </div>
        <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
          {problems.map((problem) => (
            <li key={problem.title} className="flex flex-col gap-3 bg-background p-7">
              <h3 className="text-lg font-semibold">{problem.title}</h3>
              <p className="leading-7 text-muted-foreground">{problem.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
