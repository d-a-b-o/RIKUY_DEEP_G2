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
   producción antes de guardarlo. No se ha acreditado su creación.

Comprobar el contacto de correo y los avisos de caída/recuperación en ambos
monitores. La entrega real del aviso debe probarse con un recurso de prueba,
sin provocar una caída de producción. No se ha acreditado entrega de correo.
La sección Maintenance no es necesaria para estas comprobaciones.

Referencia oficial: [API y límites del plan gratuito](https://uptimerobot.com/api/).

## Validación y cierre

Validación local del 16 de noviembre de 2026:

- Prisma Client generado, tipos y lint correctos.
- Cuatro migraciones aplicadas en PostgreSQL 16 local, base aislada `hu43_test`.
- Suite completa: 477 pruebas correctas y dos omitidas.
- Monitoreo: siete pruebas correctas, incluida persistencia/deduplicación real y
  promedio 200 ms / p95 290 ms para muestras de 100, 200 y 300 ms.
- `next build --webpack` correcto. `npm run build` con Turbopack falla en este
  entorno al iniciar el proceso que transforma CSS; sigue pendiente verificar ese
  compilador en CI. No se cambió el compilador predeterminado del proyecto.

Ejecutar generación de Prisma, tipos, lint, pruebas de monitoreo y loader, y build.
El cierre completo requiere además aplicar la migración, revisar la pantalla con
un superadministrador, confirmar eventos reales en el despliegue y completar las
dos comprobaciones externas con evidencia de correo. No cerrar T01 solo por tener
el formulario preparado.
