# RIKDP-287 · Inicialización y recuperación de TensorFlow.js

## Auditoría previa

Base: origin/main 6009e3d, rama feature/RIKDP-287-estados-carga-error-reintento-tfjs.
Árbol limpio al comenzar. Next 16.4.3, React 19, TypeScript, Tailwind 4,
TensorFlow.js 4.22, Vitest y Playwright; patrones visuales de RIKDP-274.

- RIKDP-155: lib/model/loader.ts consulta manifest, valida con manifest.ts,
  recupera IndexedDB, verifica hash opcional y recuerda versión para modo offline.
- RIKDP-156: preprocess.ts mantiene recorte y normalización existentes.
- RIKDP-157: loader.ts selecciona WebGL/WASM/CPU y hace calentamiento.
- Inspector ya muestra etapas/carga/listo/error y bloquea controles sin modelo.
- Faltan reintento sin recarga, distinción de errores recuperables, mensajes seguros,
  límites de espera y coordinación de inicializaciones. El modelo no se libera si
  falla el calentamiento, y se guarda como activo antes de comprobarlo.
- Existían pruebas de manifest/preproceso y E2E de carga/error, sin pruebas unitarias
  del cargador ni recuperación. Se amplían sin duplicar la lógica de inferencia.

Jira RIKDP-287 consultado: el alcance y los criterios coinciden con esta auditoría.
No se alteran pesos, umbral, preprocesamiento, autenticación ni contratos de API.

## Implementación y validación

Se mantienen los servicios existentes: no se añade otra implementación de TF.js,
ni dependencias, ni un modelo de producción alternativo.

- Estado inicial sin modelo, etapas de carga, listo, error y reintento explícito.
  La referencia para inferencia sólo se publica tras el calentamiento.
- Mensajes controlados: los errores internos quedan en cause, sin copiar URLs,
  cuerpos HTTP ni detalles de drivers a la pantalla. Red/descarga pueden reintentarse;
  configuración inválida o hash incorrecto requieren intervención del responsable.
- Un botón permite reintentar sin navegar ni recargar. Se bloquean doble clic y
  ejecuciones simultáneas. La carga compartida por URL tiene referencias independientes
  y dispose idempotente; las inicializaciones de distintos manifests se serializan
  porque TF.js comparte el backend global.
- IndexedDB se reutiliza; los metadatos recordados se validan con el parser existente
  y deben corresponder al manifest actual. Offline sólo usa una copia válida. La
  verificación SHA reutiliza model.json para no descargarlo por segunda vez.
- WebGL → WASM (incluido fallo en ready o calentamiento); se conserva el intento de
  CPU existente cuando el runtime lo ofrece. El calentamiento fallido libera el modelo;
  sólo se guarda y recuerda una versión que completó la inicialización.
- Esperas acotadas: petición/cuerpo HTTP 30 s, importación del motor 30 s,
  preparación de backend 20 s, lectura/escritura de caché 10 s y descarga global
  120 s. Una descarga fallida cancela peticiones hermanas; resultados tardíos de
  modelos que ya vencieron se liberan.
- TF.js no permite cancelar setBackend: si vence esa preparación se ofrece otro
  navegador y no se lanza un backend competidor mientras la operación siga pendiente.
- UI de RIKDP-274, claro/oscuro, mensajes live, foco estable al reintentar y
  controles deshabilitados mientras el modelo no está listo. La región live no
  se marca ocupada: así sus anuncios de progreso no quedan retenidos.

### Archivos

| Archivo | Cambio |
| --- | --- |
| apps/web/src/lib/model/loader.ts | Recuperación, límites, errores seguros y propiedad del modelo |
| apps/web/src/components/inspection/inspector.tsx | Estados, botón, foco y anuncios accesibles |
| apps/web/src/app/panel/inspeccion/page.tsx | Mensaje comprensible si falta configuración |
| apps/web/src/lib/model/loader.test.ts | 27 pruebas unitarias del cargador |
| apps/web/e2e/model-initialization.spec.ts | Cuatro flujos de recuperación/backend reales |
| apps/web/e2e/inspection-ui.spec.ts | Esperar primer fotograma antes de capturar la cámara simulada |
| docs/ui-ux/evidencias/RIKDP-287 | Capturas reales del build local |

### Verificaciones ejecutadas

Entorno aislado: Windows, Node 22.23.4, Chromium Playwright 1.64.1,
PostgreSQL temporal 18.6 UTF-8/UTC. Se aplicaron las migraciones existentes sólo
a esa base. Sin sesiones, correos ni modificaciones en producción.

| Verificación | Resultado |
| --- | --- |
| npm run lint | Aprobado |
| npm run typecheck | Aprobado |
| npm run build | Aprobado |
| npm test | 216 aprobadas, 13 archivos, incluidas 27 nuevas |
| Playwright relevante | 8 aprobadas, sin omisiones |
| Accesibilidad axe | Sin infracciones seleccionadas WCAG A/AA en error, reintento, caché y configuración inválida |
| Evidencias visuales | Siete PNG revisados; móvil claro y escritorio oscuro, sin información privada |

Los E2E comprueban un manifest 503, segundo intento fallido, tercer intento
exitoso sin recarga/doble solicitud, bloqueo previo a listo, descarga fallida,
recuperación offline sin descargar pesos y configuración inválida. También se
ejecutan clasificación WebGL, archivo válido/inválido, cámara simulada y WASM real
con la disponibilidad WebGL deshabilitada en HTMLCanvas/OffscreenCanvas de prueba.
La primera ejecución detectó sincronización prematura de la cámara y una simulación
incompleta de WebGL; se corrigieron los tests y se repitieron satisfactoriamente.

### Evidencias

Capturas del navegador sobre el build local y cuentas ficticias; se revisaron
visualmente el caso normal, el error y el fallback. No se accedió a la cámara física.

- [Error y reintento disponible](evidencias/RIKDP-287/error-movil-claro.png)
- [Reintento en progreso](evidencias/RIKDP-287/reintentando-movil-claro.png)
- [Recuperación y clasificación](evidencias/RIKDP-287/recuperado-movil-claro.png)
- [Descarga fallida](evidencias/RIKDP-287/descarga-fallida-escritorio-oscuro.png)
- [Caché offline](evidencias/RIKDP-287/cache-offline-escritorio-oscuro.png)
- [Configuración inválida](evidencias/RIKDP-287/configuracion-invalida-escritorio-oscuro.png)
- [Inferencia WASM real](evidencias/RIKDP-287/fallback-wasm-real.png)

### Reproducción

Desde apps/web: npm ci; npm run lint; npm run typecheck; npm test;
npm run build; npx playwright test model-initialization.spec.ts inspection-ui.spec.ts
inspection.spec.ts --workers=2. Configurar DATABASE_URL/DIRECT_URL hacia PostgreSQL
de pruebas migrado. Los E2E requieren NEXT_PUBLIC_MODEL_MANIFEST_URL y E2E_MODEL_DIR
con manifest, pesos TF.js y referencia-ok.png según e2e/support/model.ts. La variable
TFJS_EVIDENCE_DIR habilita capturas sin incluir fixtures ni secretos en Git.
Sin estos recursos los E2E dependientes se omiten explícitamente; en esta validación
se proporcionaron todos. Las 27 pruebas del cargador se ejecutan en CI con npm test.

### Límites

- Se verifica recuperación y una imagen de referencia; no es una evaluación de
  calidad PT2/PT4/PT5 ni una certificación de lectores de pantalla o hardware.
- Se reutiliza la exportación provisional 0.9.0 autorizada, sin alterar pesos ni umbral.
- Los límites protegen las esperas asíncronas. Un bloqueo nativo síncrono del driver
  durante predict no se puede interrumpir desde JavaScript sin mover TF.js a un worker,
  fuera de esta tarea.
- IndexedDB y localStorage pueden estar bloqueados: se mantiene el modo online, pero
  no se garantiza recuperación offline sin almacenamiento.
- No se modifica autenticación, preprocesamiento, API, esquema de datos ni otras pantallas.

### Criterios de aceptación

- [x] Estados diferenciados y ninguna inferencia antes de listo.
- [x] Reintento sin recarga y sin inicializaciones concurrentes.
- [x] Caché válida reutilizada y recuperación de backend comprobada.
- [x] Errores comprensibles, con acción concreta y sin detalles sensibles.
- [x] Responsive, teclado, foco y anuncios accesibles.
- [x] Pruebas, build/lint y evidencia normal/error.
- [x] Rama independiente desde main y commits con prefijo RIKDP-287.

El PR hacia main y el comentario de Jira registran los SHA y el estado final de CI.
El PR debe permanecer abierto para revisión y Jira en En revisión, sin marcar Listo.
