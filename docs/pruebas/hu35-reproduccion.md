# HU35 · Reproducción y resolución de fallos

Base auditada `98bbd55`, 2026-11-09. [Arquitectura y estado](../arquitectura/inspeccion-manual-hu35.md) · [Contratos](../arquitectura/inspeccion-manual-contratos.md) · [Resultados de esta actividad](../ui-ux/RIKDP-289-resultados.md).

Esta guía permite reproducir comprobaciones; **no es un acta de ejecución física**. No conectar estas pruebas a producción. El veredicto manual de main no se persiste.

## Entorno local

1. Node.js >=22.12 (CI usa 22), npm, PostgreSQL 16 de desarrollo/pruebas y navegador compatible con canvas, WebGL/WASM, IndexedDB y getUserMedia. Partir de la rama documental basada en main; no importar #57 para evaluar main.
2. En `apps/web`, crear `.env.local` desde [.env.example](../../apps/web/.env.example), completando valores sólo localmente. No sobrescribir un `.env.local` existente ni publicarlo.
3. Variables necesarias para página autenticada: `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_MODEL_MANIFEST_URL`. El nombre NEXT_PUBLIC indica que el manifest es público, nunca colocar ahí credenciales.
4. `SEED_DEMO_PASSWORD` permite preparar cuentas ficticias con el seed; usar una contraseña exclusiva del entorno de pruebas. Para fotos privadas: `R2_ENDPOINT_URL`, `R2_IMAGES_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. **Estas cuatro no son necesarias para obtener el veredicto local actual.** Usar sólo bucket de pruebas si se valida HU24. Credenciales limitadas a ese bucket. No copiar valores a capturas/logs.
5. Ejecutar sobre la BD local elegida (las dos órdenes db escriben en esa BD):

```powershell
cd apps/web
npm ci
npm run db:deploy
npm run db:seed
npm run dev
```

`postinstall` genera Prisma y copia binarios WASM a `public/tfjs-wasm/`. Si el generador falla, corregir la instalación antes de probar. Ver [README web](../../apps/web/README.md) y [despliegue](../despliegue.md). Entrar por `http://localhost:3000/ingresar` con ADMIN o INSPECTOR de empresa activa y abrir `/panel/inspeccion`. Cumplir política 2FA del entorno si aplica.

El manifest de prueba debe ser válido y sus rutas relativas servir model.json y shards con GET/CORS apropiados; los WASM se sirven desde el propio dominio. No alterar el manifest público compartido para inducir errores. Usar fixtures/interceptación locales. El modelo que se muestra depende de la versión activa, no se debe suponer 0.9.0 sin comprobar la fuente.

## Comprobación manual con webcam física (pendiente de ejecutar)

| Paso | Observación esperada en main | Evidencia a registrar sin datos sensibles |
| --- | --- | --- |
| Esperar modelo listo | Versión, umbral y backend; entrada bloqueada durante carga | Navegador/versión, SO, hardware, manifest y versión modelo, fecha |
| Cambiar a Cámara | Permiso del navegador; video con guía central | Dispositivo y resolución, sin personas ni documentos en encuadre |
| Centrar pieza y esperar primer frame | Video decodificado antes de pulsar; main no lo bloquea explícitamente | Condición de luz y pieza de referencia autorizada |
| Inspeccionar varias piezas | Canvas central y veredicto/confianza/tiempo local | Resultado, duración y limitación del cronometraje |
| Denegar permiso en otro contexto limpio | Mensaje de permiso; cambiar de modo para volver a montar tras habilitar permiso | Texto y recuperación observada |
| Desconectar cámara | Main no tiene recuperación dedicada; registrar resultado real, no éxito supuesto | Error observado y paso necesario para recuperar |
| Cambiar a Subir imagen / salir de página | Cleanup detiene tracks | Confirmar indicador de cámara del navegador |
| Repetir en Chrome y Edge físicos | Acta separada por navegador; RIKDP-191 | Aprobado/fallido/no ejecutado por caso |

No comparar p95 con una única muestra ni confundir `inferenceMs` con latencia desde captura o persistencia. Los objetivos HU26 p95 <500 ms y HU35 resultado <2 s requieren equipo y serie de mediciones declarados. No se ejecutaron pruebas físicas en RIKDP-289.

## Cámara simulada y modelo real

Pruebas existentes: [inspection-ui.spec.ts](../../apps/web/e2e/inspection-ui.spec.ts), [inspection.spec.ts](../../apps/web/e2e/inspection.spec.ts), [model-initialization.spec.ts](../../apps/web/e2e/model-initialization.spec.ts).
El primer archivo usa Chromium con `--use-fake-device-for-media-stream` y `--use-fake-ui-for-media-stream`; no accede a webcam física. La prueba espera dimensiones de video positivas antes de capturar. El caso clasifica un fotograma sintético, no certifica calidad de piezas industriales.

Preparar `E2E_MODEL_DIR` como ruta local a una copia autorizada del bucket: `dev/manifest.json`, `dev/v0.9.0/model.json`, shards y `referencia-ok.png`. Los casos existentes esperan ese modelo/imagen. [support/model.ts](../../apps/web/e2e/support/model.ts) intercepta las peticiones para servir el fixture; no basta una carpeta vacía. `NEXT_PUBLIC_MODEL_MANIFEST_URL` debe estar disponible tanto al compilar como al ejecutar pruebas. `DATABASE_URL` debe apuntar a PostgreSQL aislado: los fixtures crean y eliminan cuentas/datos.

```powershell
# Desde apps/web; variables configuradas sólo en el proceso/entorno local
npm run build
npx playwright install chromium
npm run test:e2e -- e2e/inspection.spec.ts e2e/inspection-ui.spec.ts e2e/model-initialization.spec.ts --project chromium --workers 1
```

Sin `PLAYWRIGHT_BASE_URL`, [playwright.config.ts](../../apps/web/playwright.config.ts) inicia el build local en puerto 3100. No dirigir PLAYWRIGHT_BASE_URL a producción. `PLAYWRIGHT_EDGE=1` habilita proyecto msedge si Edge está instalado; simulación no reemplaza acta física.

Leer el resumen completo: varios casos se **omiten** si faltan BD, manifest o E2E_MODEL_DIR. Una omisión no es una prueba aprobada. `TFJS_EVIDENCE_DIR` permite capturas de los escenarios de inicialización; revisar que no contengan cuentas/datos reales antes de compartirlas.

No usar `npm run test:camera` ni la configuración específica del PR #57 como si existieran en main: pertenecen a la rama no fusionada. Las evidencias históricas de #45/#57 conservan su procedencia y no son ejecuciones nuevas de RIKDP-289.

## Diagnóstico seguro

| Prueba / síntoma | Cómo reproducir sin afectar servicios | Resultado a comprobar |
| --- | --- | --- |
| Manifest inválido | Interceptación del fixture con JSON inválido o schemaVersion incorrecto | Error de configuración; no botón de reintento inútil |
| Descarga fallida | Interceptar model.json/shard con 503 en contexto sin caché | Error recuperable; reintentar tras restaurar fixture |
| Offline con caché | Cargar una vez correctamente; luego fallar manifest en el mismo perfil | «Sin conexión», copia local válida; no promesa de offline con perfil limpio |
| WebGL no disponible | Caso existente model-initialization bloquea contextos WebGL | WASM real clasifica usando binarios locales |
| Archivo inválido | Archivo no imagen / imagen corrupta local | Mensaje de lectura y entrada recuperable |
| Inferencia falla | Prueba aislada con modelo controlado; no modificar pesos publicados | inputError; revisar veredicto anterior por límite de main |
| R2 falla / URL caduca | Sólo al probar servicio HU24 o futura integración, bucket aislado | Firma 300 s, HTTP PUT y HEAD; HU35 actual no ejecuta estas etapas |
| BD rechaza registro | Servicio HU24 con lote cerrado, modelo inexistente o foto ausente | Códigos tipados; no fila/evento parcial |

En DevTools observar Console, Network, Application/IndexedDB y localStorage. No exportar cookies, URLs de R2 firmadas ni almacenamiento completo. Para limpiar caché, usar **sólo perfil de pruebas**; no borrar datos del usuario. La red manual debería mostrar descargas de modelo/código; no una subida de imagen ni saveInspection al capturar.

## Verificar persistencia y almacenamiento sin confundir flujos

En main HU35: inspeccionar y comprobar que no aparece llamada de firma/PUT/registro. La ausencia de una fila nueva es el comportamiento actual, no fallo de BD.

Para verificar componentes HU24 independientemente:

```powershell
# Sólo con DATABASE_URL de PostgreSQL de pruebas, migrado
npm test -- src/lib/inspections/service.test.ts prisma/integrity.test.ts
npm test -- src/lib/storage/r2.test.ts src/lib/storage/sigv4.test.ts
```

Las pruebas HU24 usan R2 simulado y datos temporales; la firma unitaria no comprueba un bucket real. La prueba de BD verifica registro/evento, aislamiento, obligatoriedad de foto y correcciones. Si se prueba R2 real de desarrollo mediante cliente autorizado, comprobar clave de empresa, PUT exitoso, HEAD, `image_key` asociado a `inspection.id` y evento CREATED. No hay botón de guardado manual actual que permita completar esto extremo a extremo. La estación `/panel/estacion` utiliza contratos y cola propios ([acciones](../../apps/web/src/app/panel/estacion/actions.ts)); probarla es HU44, no una aprobación de HU35.

Para integración futura registrar cada etapa: captura retenida, firma, subida, saveInspection e id devuelto; inducir fallo de PUT y persistencia y comprobar reintento sin perder captura ni duplicar registro. Es un plan pendiente RIKDP-192/193/194, no implementación ni prueba ejecutada.
