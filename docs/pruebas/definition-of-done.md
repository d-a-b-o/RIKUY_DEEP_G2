# Definition of Done (DoD)

Una historia de usuario está **terminada** cuando cumple todo lo siguiente. La revisa el PO en la Sprint Review. Corresponde al criterio «Salida de una HU» del [plan de pruebas](plan-de-pruebas.md#8-criterios-de-entrada-salida-y-suspensión).

## Checklist

### Código y PR

- [ ] El trabajo está en una rama `RIKDP-<clave>-HU<nn>-<Titulo>` creada desde `main`.
- [ ] La PR lleva la clave de Jira en el título o la rama (lo comprueba el job *Convenciones de la PR*).
- [ ] El check **`CI`** está en verde. Incluye:
  - lint (ESLint, Ruff) y typecheck sin errores;
  - pruebas de componente e integración (Vitest, pytest) en verde;
  - migraciones aplicadas sobre una base vacía y esquema sin cambios pendientes;
  - build de producción;
  - **prueba de humo** de Playwright (`@smoke`) en verde;
  - auditoría de dependencias sin vulnerabilidades altas y ningún archivo de más de 5 MB.
- [ ] La PR está fusionada en `main`. Se fusiona sola con auto-merge cuando `CI` pasa.
- [ ] Una persona distinta del autor revisó la PR. La aprobación no bloquea la fusión, así que la revisión puede ser posterior. Lo que encuentre se registra en Jira como **Error** con su severidad (S1–S4).

### Pruebas

- [ ] La lógica nueva tiene pruebas de componente. Si toca la base de datos, también tiene pruebas de integración.
- [ ] Si tiene pantallas, añade o actualiza sus pruebas de Playwright en `apps/web/e2e/`. Los flujos críticos llevan `@smoke` y el resto `@regression`.
- [ ] Ninguna prueba se ha saltado, desactivado ni marcado `@flaky` para conseguir el verde. Un `@flaky` lleva su Error en Jira.
- [ ] Sus casos formales siguen en PT1–PT5 para las Semanas 13 a 15.

### Calidad del producto

- [ ] Cumple **todos** sus criterios de aceptación y se demostraron en la Review, en el preview de Vercel o en producción.
- [ ] Las pantallas funcionan en 360, 768 y 1280 px sin scroll horizontal y respetan la [identidad visual](../identidad-visual.md) (contraste WCAG AA).
- [ ] No hay defectos S1 ni S2 abiertos de la historia.
- [ ] No hay secretos en el repositorio. Las variables nuevas están en `.env.example` y en [despliegue](../despliegue.md).

### Documentación y Jira

- [ ] Se actualizaron los documentos afectados: `docs/arquitectura/`, un ADR nuevo si hubo una decisión de arquitectura, y el README de la app.
- [ ] Las subtareas están en **Finalizada** y la historia tiene un comentario con el enlace a la PR y cómo se verificó.

## Excepciones

Si un criterio no se puede cumplir, por ejemplo porque depende de un servicio externo todavía sin acceso, el PO decide en la Review:

- acepta la historia y el pendiente queda como subtarea o Error con fecha; o
- la historia sigue abierta en el siguiente sprint.

Lo que no se acepta nunca es fusionar con `CI` en rojo.
