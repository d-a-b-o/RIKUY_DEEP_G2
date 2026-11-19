# RIKDP-292 · Resultados de UI y QA

Base auditada: `origin/main` en `ac48b29`. Rama `feature/RIKDP-292-material3-landing-motion`. La revisión abarca landing, acceso y el código del panel e inspección; se intervino la landing por ser la prioridad solicitada, sin cambiar contratos, autenticación, inferencia o base de datos.

## Auditoría y cambio

El hero ya tenía dos columnas y CTA; la ilustración previa mostraba un defecto localizado aunque la inferencia sólo devuelve una clasificación. La nueva vista ilustra captura, análisis y resultado sin cajas ni ubicaciones de defecto. Usa SVG original, no ejecuta TF.js ni solicitudes de red, identifica el resultado y la confianza como ejemplos, y ofrece pausa accesible. La animación se pausa fuera de pantalla y se sustituye por un estado estático con `prefers-reduced-motion`. La landing conserva textos, enlaces, logo, Geist y tokens.

La composición usa una superficie tonal, separación de capas, botones existentes y controles con foco visible, siguiendo principios de Material 3 adaptados a la identidad industrial. Los demás componentes de landing y el panel no se modificaron funcionalmente. La presentación de referencia recibida contiene las direcciones Forge Command, Clarity Ops y Trace Studio para vistas privadas; se mantuvo la landing como prioridad y no se aplicaron esas plantillas como un rediseño funcional.

## Evidencias locales

Capturas antes/después en `.dev-private/RIKDP-292/antes/` y `despues/`, para 360, 390, 768, 1280 y 1440 px. Se capturó la landing local mediante Playwright MCP. No se fotografiaron pantallas privadas ni se usaron credenciales. Las capturas iniciales usaron una fuente de respaldo porque el entorno de desarrollo no pudo descargar Geist; las capturas finales seleccionadas corresponden al build de producción local, que sí descargó Geist. Esto limita la comparación tipográfica directa.

Evidencias sanitizadas: [antes 1280](evidencias/RIKDP-292/antes-1280.png), [después 1280](evidencias/RIKDP-292/despues-1280.png), [antes 360](evidencias/RIKDP-292/antes-360.png), [después 360](evidencias/RIKDP-292/despues-360.png).

## Validaciones realizadas

- ESLint completo: aprobado con las dependencias restauradas desde el lockfile.
- `git diff --check`: sin errores.
- Playwright en 360/390/768/1280/1440: sin desbordamiento horizontal; enlaces de CTA presentes; movimiento reducido desactiva escaneo y animación de resultado; botón de pausa cambia `aria-pressed` a true.
- Axe WCAG 2 A/AA y 2.1 AA en la landing de 1280: cero infracciones tras corregir el contraste del resultado. Enter activa pausa y el CTA secundario navega a `#como-funciona`. No equivale a una evaluación completa de lector de pantalla o WCAG.
- Suite Vitest tras restaurar dependencias: 296 pruebas aprobadas, 10 omitidas y 12 suites fallidas porque no se configuró `DATABASE_URL` para una base aislada. No se consideran aprobadas las suites fallidas u omitidas.
- `npm run typecheck`: aprobado tras regenerar el cliente Prisma. Un primer intento con dependencias desactualizadas falló por módulos ausentes y cliente incompatible.
- `npm run build`: aprobado con acceso de red para las fuentes Geist tras restaurar las dependencias. No se ha medido LCP/CLS comparables ni tamaño de bundle.
- Playwright Chromium `e2e/landing.spec.ts`: 4 aprobadas, 0 omitidas, sobre el build local; incluye pausa por teclado, movimiento reducido, CTA y formulario. Un primer intento no arrancó por falta del navegador correspondiente; se instaló Chromium y se repitió.
- 21st MCP: búsqueda de patrones de hero; shadcn MCP: metadatos de button, navigation-menu y sheet. `21st review` emitió 104 observaciones informativas de colores literales, incluidas definiciones de tokens y SVG; no se aplicaron cambios automáticos ni se añadieron dependencias UI.

## Pendientes

Disponer de PostgreSQL aislado para repetir las 12 suites de integración. Comparar rendimiento antes/después y validar con lector de pantalla y dispositivos. La carpeta privada contiene scripts de verificación y no se incluye en el commit.
