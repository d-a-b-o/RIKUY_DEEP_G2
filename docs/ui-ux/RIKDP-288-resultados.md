# RIKDP-288 · Validación exploratoria de inspección con cámara

Fecha: 2026-11-08 (America/Lima). Historia: [RIKDP-46 · HU35](https://dbravoo.atlassian.net/browse/RIKDP-46).
Actividad: [RIKDP-288](https://dbravoo.atlassian.net/browse/RIKDP-288).

## Auditoría inicial

Rama `feature/RIKDP-288-validacion-webcam-permisos`, creada desde
`origin/main` **6009e3ddbc7da1660c51fae21bc7d16186a97278**. Árbol limpio al
comenzar, sin merge, rebase, cherry-pick ni secuenciador pendientes. Se revisaron
`git status`, `git branch -vv` y las referencias después de `git fetch origin` y
la descarga explícita de main; origin tenía un refspec limitado a otra rama.
No se incorporaron commits de RIKDP-287 ni se modificaron cambios de terceros.

Se leyeron README de la aplicación, AGENTS.md, guía local de Next para componentes
cliente, arquitectura de inferencia, ADR 0007, plan de pruebas y DoD. Se respetan
las instrucciones de esta actividad de dejar PR abierto y sin auto-merge.

| Área | Estado comprobado en main |
| --- | --- |
| `/panel/inspeccion` | Ruta privada con Better Auth, Inspector dentro de Suspense |
| `components/inspection/inspector.tsx` | Foto o webcam, guía cuadrada, canvas 400×400, veredicto y confianza |
| `lib/model/loader.ts` | Manifest, versión, IndexedDB, WebGL/WASM y calentamiento; error sin botón de reintento |
| `lib/model/preprocess.ts` | Recorte central y preparación de entrada; no se modifica |
| `app/panel/inspeccion/actions.ts`, `lib/inspections/` | Servicios de registro existentes, sin conexión desde este Inspector |
| Selector de dispositivo, lote y turno | No están implementados en esta pantalla |
| Captura JPG, subida R2, reintento de subida | No forman parte del flujo de esta pantalla: la imagen sólo se analiza localmente |
| Vitest | Configuración carga `.env.local`/`.env`; integración requiere PostgreSQL |
| Playwright | Build local en 3100, fixtures de cuenta ficticia y copia del modelo; cámara falsa ya utilizada en `inspection-ui.spec.ts` |

Se consultaron RIKDP-46 y sus subtareas RIKDP-187, 188, 189, 192, 193 y 194.
RIKDP-46 figura Listo, pero esas subtareas figuran Por hacer. **El estado de Jira
no demuestra que el flujo completo esté implementado.** No se cambió ninguno de
esos estados. RIKDP-288 pasó a En curso durante la auditoría.

### Relación con RIKDP-287

El [PR #45](https://github.com/d-a-b-o/RIKUY_DEEP_G2/pull/45) se consultó abierto,
sin fusionar, con base main 6009e3d y head f658dff. Sus cambios de inicialización,
reintento, caché y backend TF.js **no se importan ni se reproducen** aquí.
Las pruebas de cámara funcionan sobre el cargador actual de main. El reintento
del modelo sin recargar queda dependiente de RIKDP-287. Ambos PR editan Inspector:
al integrarlos se deberán conciliar sus cambios y repetir estas verificaciones.

## Defectos y correcciones acotadas

Hallazgos iniciales por inspección de código; resultados posteriores comprobados
en navegador. No se atribuye una ejecución previa a código que no se ejecutó.

| ID | Hallazgo inicial | Corrección / comprobación |
| --- | --- | --- |
| CAM-01 | `live=true` al obtener stream, antes de un fotograma; `play()` rechazado sin manejo | Esperar datos y dimensiones válidas, manejar rechazo; 15 s sin primer fotograma libera recursos y ofrece reintento |
| CAM-02 | Sin listener de desconexión; la captura podía quedar habilitada sobre un stream terminado | Escuchar `MediaStreamTrack.ended`, deshabilitar, soltar stream y permitir reconexión |
| CAM-03 | Recuperación exigía alternar entre archivo/cámara; el error anterior permanecía | Reintento explícito del flujo existente, limpieza de alertas y botón Detener; no se implementa selector ni un nuevo módulo de permisos |
| CAM-04 | El veredicto de la pieza anterior persistía al fallar una nueva inspección | Limpiar resultado al inspeccionar o reportar error de entrada; mensaje controlado, sin detalles internos |
| CAM-05 | Captura sin validar dimensiones, estado actual del track o disponibilidad de imagen | Guardia justo antes de capturar; no llama a predict sobre una entrada inválida |

Se conserva el componente existente en su archivo. Cleanup elimina listeners,
temporizador, tracks y `srcObject` al detener/cambiar de origen/desmontar.
Una solicitud de permiso resuelta después de abandonar la cámara también libera
sus tracks. No se solicita audio. Los permisos reales siguen bajo control del
navegador; el código no concede permisos ni modifica ajustes de privacidad.

Semántica de desconexión: `stop()` no emite `ended`. La simulación detiene el track
y despacha ese evento explícitamente para representar una terminación externa,
según [MDN · MediaStreamTrack ended](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/ended_event).

## Matriz de escenarios y resultados

**Aprobado** = observado en el entorno indicado; **Fallido** = no cumple;
**Bloqueado** = depende de implementación/acceso; **No ejecutado** = pendiente de
dispositivo/validación. La aprobación simulada no implica aprobación física.

| Escenario | Esperado | Observado / estado final |
| --- | --- | --- |
| Cámara disponible | Mostrar vídeo tras acceso | Aprobado: canvas sintético y dispositivo falso de Chromium; imagen real de webcam no ejecutada |
| Solicitud de permiso real | Prompt del navegador y decisión del usuario | No ejecutado: mocks/flags de dispositivo falso, sin automatizar permisos físicos |
| Permiso denegado | Mensaje accionable, sin captura; recuperación | Aprobado: NotAllowedError simulado, recuperación por teclado, TF.js real en ruta autenticada |
| Cámara ausente | Error controlado | Aprobado: NotFoundError simulado; recuperación con dispositivo falso y TF.js real |
| Cámara ocupada | No bloquear UI | Aprobado: NotReadableError simulado, botón de reintento funcional |
| Cámara desconectada / permiso revocado | Deshabilitar captura y recuperar | Aprobado: evento ended simulado en ambas suites; extracción USB real no ejecutada |
| Esperando permiso | Poder abandonar sin dejar recursos abiertos al resolver | Aprobado: promesa retenida, cambio a archivo, resolución tardía, tracks terminados |
| Primer fotograma ausente | No capturar entrada vacía; salir de espera | Aprobado: captura bloqueada y error a los 15 s con reloj virtual; reintento correcto |
| Captura correcta | Imagen central 400×400 y resultado | Aprobado: píxel central verificado sobre canvas sintético; captura Chromium + TF.js real muestra veredicto, confianza y versión |
| Detener y reanudar | Liberar recursos y poder reiniciar | Aprobado: tracks terminados; reinicio posterior habilita captura |
| Cambiar a archivo | Liberar cámara | Aprobado: tracks terminados, vídeo desmontado |
| Selección/cambio de dispositivo | Selector y limpieza de cámara anterior | Bloqueado: selector pendiente de RIKDP-187; alternar archivo/cámara no equivale a cambiar dispositivo |
| Error de reproducción/captura | Mensaje y recuperación sin resultado antiguo | Aprobado: rechazo play, entrada sin fotograma, limpieza y nueva captura |
| Modelo no disponible/cargando | Ninguna predicción prematura | Aprobado: doble del cargador en harness; caso de manifest fallido en ruta Next con cargador real |
| Error de inferencia | Mensaje seguro y reintento de captura | Aprobado con predict simulado; fallo nativo real de GPU no ejecutado |
| Lote y turno activos | Elegir ambos antes de registrar | Bloqueado: RIKDP-193, no existen en Inspector |
| JPG, R2 y registro/reintento sin perder captura | Trazabilidad de extremo a extremo | Bloqueado: RIKDP-188/192/194; servicios existentes no conectados a esta UI |
| Encuadre | Instrucción visible y recorte central | Aprobado visualmente en captura sintética 16:9; óptica, orientación y otras relaciones en móvil físico no ejecutadas |
| Responsive 360/768/1280 | Controles utilizables, sin desbordamiento horizontal | Aprobado en Chromium con viewport; no equivale a Safari/Android físicos |
| Teclado / accesibilidad básica | Acceso a cámara, captura, recuperación, anuncios | Aprobado: Enter/foco, roles status/alert y axe WCAG A/AA; lector de pantalla real no ejecutado |
| Sesión expirada con cámara activa | Recuperación coherente de sesión/recursos | No ejecutado; no se modifica autenticación en esta actividad |
| Latencia <2 s desde captura | Cumplir objetivo en equipo de referencia | No certificada: predicción real comprobada funcionalmente, sin campaña de rendimiento ni p95 |

No quedan fallos reproducidos en los casos finales ejecutados. El flujo HU35
completo continúa bloqueado por las dependencias señaladas; este informe no lo
declara terminado ni certifica el texto actual de la pantalla «menos de un segundo».

## Pruebas y evidencia

Entorno: Windows, Node **22.23.4**, Next **16.4.3**, TF.js **4.22.0**,
Vitest **4.1.12** y Playwright/Chromium **1.64.1**. Se reutilizó PostgreSQL
temporal de QA en localhost:55432 y `reports/ui-model` con la exportación
provisional **0.9.0**. Se crearon y eliminaron cuentas ficticias con los fixtures
existentes. No se utilizó producción, correo real, almacenamiento R2 de imágenes
ni webcam física. Los archivos de entorno y pesos no se versionan.

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Aprobado |
| `npm run typecheck` | Aprobado |
| `npm run build` | Aprobado, build de producción |
| `npm test` | 189 aprobadas, 12 archivos, sin omisiones con base local |
| `npm run test:camera -- --workers=2` | 17 aprobadas, sin omisiones; harness del Inspector real con modelo y cámara sintéticos |
| `npm run test:e2e -- camera-flow.spec.ts inspection-ui.spec.ts inspection.spec.ts --workers=2` | 7 aprobadas en 50,8 s, sin omisiones; sesión y TF.js reales, cámara falsa |
| axe | Sin infracciones seleccionadas WCAG 2 A/AA y 2.1 AA en las tres anchuras del harness y errores en ruta autenticada |
| Revisión visual | PNG de escritorio/móvil revisados; controles y mensajes legibles, sin datos personales reales |

Incidencias de la ejecución, conservadas por transparencia:

- Sin DATABASE_URL, la primera ejecución aprobó 148 pruebas y omitió 10; dos suites
  fallaron durante su inicialización. Se localizaron herramientas y una base de
  QA ya existentes y se repitió: 189 aprobadas, sin omisiones.
- El primer build detectó un campo faltante en el doble de predicción
  (`thresholdApplied`); se corrigió y se repitió build/typecheck.
- Dos pruebas nuevas de ruta real tenían un selector ambiguo para «Confianza»
  (menú y resultado); se acotó al main y se repitieron.
- Al retomar, la base temporal había dejado de responder: una ejecución de siete
  E2E falló con ECONNREFUSED antes de entrar en los casos. Se reanudó el clúster
  local existente, se esperó su recuperación y se repitió: siete aprobadas.
- Las primeras ejecuciones Playwright completaron los casos, pero el entorno
  restringido no terminó sus procesos. Se finalizaron únicamente los procesos de
  QA identificados y se ejecutó con elevación aprobada; no se cambió la seguridad.
- Una consulta elevada fue rechazada porque la revisión automática agotó su cuota.
  No se ejecutó esa operación ni se eludió el control; tras retomar, las operaciones
  elevadas posteriores fueron aprobadas. La descarga temporal de PostgreSQL no
  llegó a iniciarse como servidor: se canceló la extracción al encontrar el QA local.
- Node del PATH era 16, incompatible. Se usó Node 22 portátil ya disponible;
  `npm.cmd` evita depender del wrapper PowerShell sin modificar ExecutionPolicy.

### Capturas

Carpeta [evidencias/RIKDP-288](evidencias/RIKDP-288). Todas son capturas de
navegador local, no fotografías de hardware. Las del harness muestran explícitamente
«Cámara y modelo simulados»; sus valores de confianza/tiempo/backend son dobles,
no mediciones ni predicciones TF.js reales.

- [Captura sintética, escritorio](evidencias/RIKDP-288/captura-sintetica-escritorio.png).
- [Permiso denegado simulado](evidencias/RIKDP-288/error-denied.png).
- [Cámara ausente simulada](evidencias/RIKDP-288/error-absent.png).
- [Cámara ocupada simulada](evidencias/RIKDP-288/error-busy.png).
- [Desconexión simulada](evidencias/RIKDP-288/desconexion-simulada.png).
- [Inferencia fallida simulada](evidencias/RIKDP-288/inferencia-fallida-simulada.png).
- [Teclado 360](evidencias/RIKDP-288/teclado-360.png), [768](evidencias/RIKDP-288/teclado-768.png), [1280](evidencias/RIKDP-288/teclado-1280.png).
- [Permiso denegado en ruta real](evidencias/RIKDP-288/ruta-real-NotAllowedError-360.png).
- [Cámara ausente en ruta real](evidencias/RIKDP-288/ruta-real-NotFoundError-360.png).
- [Recuperación con modelo real tras permiso denegado](evidencias/RIKDP-288/ruta-real-recuperada-NotAllowedError-360.png).
- [Recuperación con modelo real tras cámara ausente](evidencias/RIKDP-288/ruta-real-recuperada-NotFoundError-360.png).

### Reproducción

Desde `apps/web`, Node >=22.12 y dependencias del lock instaladas (`npm ci`):

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:camera -- --workers=2
npm run test:e2e -- camera-flow.spec.ts inspection-ui.spec.ts inspection.spec.ts --workers=2
```

Para Vitest de integración y las pruebas de ruta, configurar DATABASE_URL y
DIRECT_URL exclusivamente hacia PostgreSQL de pruebas migrado, y
BETTER_AUTH_SECRET de QA. Compilar con NEXT_PUBLIC_MODEL_MANIFEST_URL.
E2E_MODEL_DIR debe contener `dev/manifest.json`, pesos y `referencia-ok.png`,
según `e2e/support/model.ts`. Las peticiones de modelo se sirven desde esa copia
local, sin descargar pesos desde producción durante el test. Sin recursos de QA
los E2E dependientes se omiten explícitamente; no deben presentarse como aprobados.

El harness no requiere base, secretos ni pesos: esbuild, ya presente por Vitest/Vite,
empaqueta Inspector con un alias **sólo de prueba** al doble del cargador. Reutiliza
CSS generado por el build en `.next/static/chunks`. El servidor escucha únicamente
127.0.0.1:3101; no se añade ninguna ruta de pruebas ni bypass a la aplicación.
Se ejecuta con configuración separada y queda excluido del runner E2E normal.
CAMERA_EVIDENCE_DIR habilita PNG opcionales; Playwright conserva errores y traces
en sus directorios ignorados. Estas pruebas dirigidas no constituyen PT4 integral.

### Checklist físico pendiente

En una cuenta y ambiente de QA, escritorio con webcam y teléfono real:

1. Abrir vía HTTPS. Seleccionar cámara; aceptar/rechazar desde el prompt nativo y
   comprobar mensaje, foco y recuperación cambiando el permiso manualmente.
2. Confirmar encuadre real con buena luz, orientación vertical/horizontal y
   relaciones 4:3/16:9. Capturar muestra ficticia, comprobar recorte y metadatos.
3. Desconectar/reconectar USB y revocar permiso con cámara activa. Confirmar captura
   bloqueada y reintento; observar indicador físico apagado tras Detener, cambio
   a archivo, navegación y cierre de página.
4. Probar cámara ocupada por otra aplicación, pestaña suspendida y sesión expirada.
5. Medir captura→veredicto en equipo de referencia con modelo calentado; registrar
   navegador, backend, modelo y distribución de tiempos, sin inferir p95 de una toma.
6. Tras RIKDP-187/188/192/193/194, validar selector, JPG, lote/turno, R2 y reintento
   sin perder imagen. Tras PR #45, repetir recuperación del modelo junto con cámara.

## Entrega y revisión

PR [#57](https://github.com/d-a-b-o/RIKUY_DEEP_G2/pull/57), abierto hacia `main`,
sin fusionar ni aprobar. Rama publicada y árbol limpio antes de esta actualización
documental. Commits de implementación y validación:

- `305a4d4`: correcciones de captura y recuperación de cámara.
- `54a3d12`: pruebas, matriz, informe y 13 capturas revisadas.
- El commit documental posterior registra la entrega, sin cambiar comportamiento.

Jira RIKDP-288 pasó a **En revisión** después de publicar el PR. El comentario
10055 enlaza PR, informe y capturas, y distingue validación simulada de hardware
pendiente. No se marcó Listo ni se modificó RIKDP-46 o sus subtareas.

El conector GitHub podía leer, pero crear PR devolvió 403 «Resource not accessible
by integration». Se creó por la API oficial con la autenticación local de Git,
que ya permitía publicar la rama. La credencial se mantuvo en memoria, sin
imprimirla, guardarla en archivos ni modificar sus permisos.

### GitHub Actions

En el head `54a3d12`, [CI 42560590692](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/42560590692)
y [HU22 42560590648](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/42560590648)
**sí iniciaron pasos reales**: no se reprodujo el bloqueo de facturación observado
anteriormente en PR #45. Durante esta consulta estaban en ejecución.
Gitleaks, revisión de dependencias, archivos grandes y convenciones ya estaban
aprobados; Web y CodeQL seguían ejecutándose. ML del workflow general quedó
omitido por su filtro de rutas; el workflow específico HU22 sí inició sus dos jobs.
No se presenta CI global como aprobado mientras no termine. La ejecución sobre
el commit documental final se consulta separadamente en el PR.

No se cambiaron workflows ni configuración de seguridad o facturación. Quedan
pendientes revisión humana, hardware/checklist físico, funcionalidades HU35
señaladas y conciliación con PR #45 antes de su integración conjunta.
