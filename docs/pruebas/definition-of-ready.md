# Definition of Ready (DoR)

Una historia de usuario está **lista** para entrar a un sprint cuando cumple todo lo siguiente. Se revisa en el refinamiento, antes de la planificación del sprint. Es la verificación estática del lado de requisitos del [modelo en V](plan-de-pruebas.md#2-estrategia-modelo-en-v-aplicado-a-rikuydeep).

## Checklist

### Historia

- [ ] Está en Jira (proyecto RIKDP) con número de HU y redactada como *Como [usuario], quiero [acción], para [beneficio]*.
- [ ] Tiene **criterios de aceptación** numerados, verificables y sin ambigüedad: se puede decir sí o no a cada uno en la Sprint Review.
- [ ] Tiene prioridad de negocio (Must, Should, Could), riesgo de desarrollo y **story points** estimados por el equipo.
- [ ] Cabe en un sprint. Si no cabe, se divide antes de entrar.
- [ ] Tiene responsable y sprint asignados.

### Diseño

- [ ] Si tiene pantallas, el flujo y los estados (vacío, cargando, error, éxito) están acordados con el PO.
- [ ] Si afecta permisos, se sabe qué roles pueden hacer qué (matriz de roles).
- [ ] Si cambia la arquitectura, el modelo de datos o el modelo de IA, hay un ADR propuesto o se sabe qué documento de `docs/arquitectura/` hay que actualizar.

### Dependencias

- [ ] Las historias de las que depende están terminadas o entran en el mismo sprint antes que ella.
- [ ] Los servicios externos que necesita (Neon, Vercel, R2, Resend, DagsHub) tienen cuenta y acceso, o hay una subtarea para conseguirlos.
- [ ] Los datos que necesita existen: dataset, imágenes de prueba, seed.

### Pruebas

- [ ] Se sabe cómo se demostrará cada criterio de aceptación en la Review.
- [ ] Sus casos de prueba formales están identificados en el [catálogo](plan-de-pruebas.md#anexo-a-catálogo-de-casos-de-prueba-en-jira) (PT1–PT5) o se crean como subtarea de la PT que corresponda.
- [ ] Están divididas en subtareas con responsable.

## Qué pasa si no se cumple

La historia no entra al sprint: vuelve al backlog con un comentario en Jira que diga qué falta. Excepción: el PO puede aceptarla con un punto pendiente si ese punto se resuelve en los dos primeros días del sprint. El punto queda escrito en Jira.
