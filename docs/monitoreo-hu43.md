# HU43 — Salud de la aplicación y del modelo

RIKDP-54: T01 (RIKDP-222), T02 (RIKDP-223), T03 (RIKDP-224).

## Desarrollo

- `/api/health`: público, dinámico y sin caché. Comprueba la conexión a PostgreSQL:
  200 si responde, 503 si falla. No expone secretos ni detalles internos.
- `/panel/admin/monitoreo`: exige `monitoreo:ver` en el proxy, la página y la consulta
  de métricas. Solo SUPERADMIN tiene ese permiso y debe cumplir la política 2FA.
  Comprueba base de datos y descarga/valida el manifest configurado, con límite de
  tiempo y de tamaño. No descarga pesos ni acredita una inferencia correcta.
- El loader compartido registra inferencias reales después del calentamiento,
  con duración, versión y motor (incluido CPU), y fallos de inicialización por etapa.
  No envía imágenes, resultados de calidad, URLs ni mensajes arbitrarios del navegador.
- `/api/telemetry/model`: exige sesión y actor activo, empresa activa, cumplimiento
  2FA y permiso de inspección o estación activa. La empresa la determina el servidor.
  Valida el esquema, máximo 50 eventos/16 KiB, Origin y límite compartido por IP
  (120/minuto) y usuario (12/minuto). IDs únicos permiten reintentos sin duplicados.
- Envíos en segundo plano cada 15 segundos, cola en memoria de hasta 200 eventos,
  lotes de 50 y espera de un minuto tras fallos. Se intenta enviar un lote al salir.
  No hay garantía de entrega: los cierres, desconexiones o exceso de eventos pueden
  perder muestras. La inspección no depende del éxito de la telemetría.
- La pantalla agrupa eventos recibidos en las últimas 24 h por versión y motor,
  o etapa del fallo, con recuento, promedio y p95 calculado en PostgreSQL. El tiempo
  excluye captura, persistencia y calentamiento. No es un indicador de SLA ni una
  medición de todas las inferencias. Sin eventos se muestra explícitamente ese estado.

## Despliegue

Aplicar `npm run db:deploy` antes de servir el código. La migración
`20261116223000_hu43_monitoring` añade CPU al enum, una etiqueta de versión para
eventos cuyo modelo todavía no esté registrado y un índice temporal. `build:vercel`
ya aplica migraciones. No se ha ejecutado esta migración contra producción durante
el desarrollo local.

La URL se obtiene de `NEXT_PUBLIC_MODEL_MANIFEST_URL`; no hay un modelo fijo en
el código de monitoreo. Los datos son reportados por clientes y no deben tratarse
como una auditoría de confianza. El período de 24 horas limita la consulta, pero no
borra registros: acordar y programar retención antes de una operación prolongada.

## UptimeRobot (plan gratuito)

Configurar monitores HTTP con intervalo de cinco minutos y destinatario de correo
verificado, sin activar opciones de pago:

1. Web: `https://rikuydeep.vercel.app/`. Ya se observó el monitor `804699929`
   activo y Up. Tras desplegar HU43 conviene apuntarlo a `/api/health` para incluir
   disponibilidad de la base de datos.
2. Modelo: la URL exacta de `NEXT_PUBLIC_MODEL_MANIFEST_URL` del despliegue.
   El formulario se preparó con `https://bucket.d-a-b-o.dev/dev/manifest.json`,
   la configuración provisional del repositorio; confirmar que coincide con
   producción antes de guardarlo. En una revisión posterior de Edge se confirmó
   que el monitor `804699985` ya está creado para esta URL, activo y Up, con
   comprobación cada cinco minutos. No fue necesario crear otro monitor.

Comprobar el contacto de correo y los avisos de caída/recuperación en ambos
monitores. La entrega real del aviso debe probarse con un recurso de prueba,
sin provocar una caída de producción. La evidencia disponible se detalla abajo.
La sección Maintenance no es necesaria para estas comprobaciones.

Revisión posterior en las sesiones proporcionadas por el responsable:

- Monitor web `804699929`: Up, intervalo cinco minutos, contacto de alertas
  asignado a la cuenta. Monitor del manifest `804699985`: mismas condiciones.
- La sesión de RikuyDeep permitió abrir Empresas, pero la ruta
  `/panel/admin/monitoreo` devolvió la pantalla 404. La sesión preparada no
  sustituye el despliegue del código HU43, cuyo PR se dejó pendiente por indicación
  del responsable.
- Inicialmente no se envió ninguna notificación de prueba. La revisión automática rechazó el
  clic en Test Notification por falta de autorización explícita para enviar correo.
  Después, el responsable autorizó explícitamente los dos avisos. Se pulsó
  `Send test notifications` una vez en cada monitor; ambos diálogos se cerraron
  sin error visible. Esto acredita la solicitud en la interfaz, no la entrega
  del correo. Se solicitó al responsable confirmar la recepción de ambos avisos.

El responsable aportó posteriormente dos capturas del correo recibido el
16 de noviembre de 2026, alrededor de las 19:50 (Lima), con los asuntos
`TEST: Monitor is DOWN: bucket.d-a-b-o.dev/dev/manifest.json` y
`TEST: Monitor is UP: bucket.d-a-b-o.dev/dev/manifest.json`.
Esto confirma la recepción de los avisos de prueba de caída y recuperación
del **monitor del manifest**. El prefijo TEST y los campos N/A indican una
simulación: no constituyen evidencia de una caída real. Las capturas no muestran
la dirección completa del destinatario ni acreditan la recepción del aviso del
monitor web, que sigue pendiente de confirmar. No se copiaron direcciones de
correo ni imágenes privadas al repositorio.

Referencia oficial: [API y límites del plan gratuito](https://uptimerobot.com/api/).

## Validación y cierre

Validación local del 16 de noviembre de 2026:

- Prisma Client generado, tipos y lint correctos.
- Cuatro migraciones aplicadas en PostgreSQL 16 local, base aislada `hu43_test`.
- Suite completa: 477 pruebas correctas y dos omitidas.
- Monitoreo: siete pruebas correctas, incluida persistencia/deduplicación real y
  promedio 200 ms / p95 290 ms para muestras de 100, 200 y 300 ms.
- `next build --webpack` correcto localmente. Turbopack presentó un fallo local
  al iniciar el proceso que transforma CSS. La verificación posterior en CI de
  main sí pasó: `npm run build` ejecutó Next.js 16.4.6 con Turbopack y compiló
  correctamente en 6,2 segundos. No se cambió el compilador predeterminado.

Verificación tras fusionar PR #81: main `461092ecd360736d8d40d97b8ca03c31f7b4c616`.
La [ejecución CI 43992662407](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/43992662407)
terminó correctamente, incluidos migraciones, pruebas, build Turbopack y humo
Playwright. Se ejecutó el 16 de noviembre de 2026 entre las 20:04 y 20:07 (Lima).
La comprobación pública posterior de `/api/health` respondió 200 con
`status: ok` a las 20:09 (Lima). Esto acredita la comprobación de base de datos
del endpoint desplegado; no reemplaza la revisión de pantalla autenticada ni
la recepción de telemetría real. Las observaciones anteriores de 404 y PR
pendiente corresponden al estado previo a esta fusión.

Ejecutar generación de Prisma, tipos, lint, pruebas de monitoreo y loader, y build.
El cierre completo requiere además aplicar la migración, revisar la pantalla con
un superadministrador, confirmar eventos reales en el despliegue y completar las
dos comprobaciones externas con evidencia de correo. No cerrar T01 solo por tener
el formulario preparado.
