# HU35 · Contratos reales y brechas de integración

Complemento de [arquitectura HU35](inspeccion-manual-hu35.md), base `98bbd55` (2026-11-09). **Los contratos backend existen; el inspector manual aún no los invoca.** No hay endpoint REST nuevo definido por este documento.

## Navegador: datos internos

Fuentes: [loader.ts](../../apps/web/src/lib/model/loader.ts), [manifest.ts](../../apps/web/src/lib/model/manifest.ts), [inspector.tsx](../../apps/web/src/components/inspection/inspector.tsx).

| Campo | Tipo / validación | Origen → destino | Uso real |
| --- | --- | --- | --- |
| `LoadedModelInfo.version` | string del manifest validado X.Y.Z | manifest → UI | Versión mostrada, no id de BD |
| `threshold`, `input` | number (0,1); width/height positivos, channels=3, scale>0, offset finito | manifest → predict/canvas | Obligatorios en manifest |
| `backend` | `webgl / wasm / cpu` | loader → UI | No coincide directamente con enum persistido |
| `source`, `offline`, `loadMs` | cache/network; boolean; number | loader → UI | Metadatos locales; no equivalen a source CAMERA |
| `verdict` | OK / DEFECTIVE | classify → UI | Se compara p con umbral |
| `confidence`, `defectProbability` | number [0,1] | predict → UI | La probabilidad de defecto no se persiste como campo separado |
| `thresholdApplied`, `inferenceMs` | number; duración fraccionaria posible | predict → UI | Backend pide inferenceMs entero |
| `label` | string | Inspector → Verdict | Nombre de archivo u hora local; no es capturedAt persistible |
| Estado de modelo | idle/loading/retrying/ready/error; stage; progress opcional | loader/React → UI | No se envía a saveInspection |
| `busy`, `inputError` | boolean / string o null | React → UI | No hay registro persistido de procesamiento/error HU35 |
| Tensor | float32 `[1,H,W,3]`, RGB normalizado | canvas → TF.js | Nunca se envía al backend ni se almacena en R2 |

No hay un `modelName` independiente en el DTO ni nombre de modelo en `LoadedModelInfo`; se referencia una versión. No inventar ese campo. Tampoco hay id de inspección en el resultado local.

## Firma de imagen y transporte

[requestImageUpload](../../apps/web/src/app/panel/inspeccion/actions.ts) no recibe argumentos; devuelve `ActionResult<ImageUpload>`. [ImageUpload](../../apps/web/src/lib/storage/r2.ts) contiene:

| Campo obligatorio | Tipo | Origen → destino / validación |
| --- | --- | --- |
| `key` | string | Servidor genera clave de empresa → cliente → imageKey al registrar |
| `uploadUrl` | string | Firma SigV4 PUT, TTL 300 s → cliente → R2; dato temporal sensible |
| `method` | literal PUT | Servidor → cliente |
| `headers` | `{ "content-type": "image/jpeg" }` | Servidor → petición PUT; no prueba inspección del contenido |
| `expiresAt` | Date | Servidor → cliente por transporte Server Actions |

El PUT lleva bytes JPG, no tensores ni JSON. La generación del blob y la llamada PUT son **pendientes en HU35**. R2 devuelve su respuesta HTTP; el servicio confirma posteriormente existencia con HEAD antes del registro. No existe contrato de API para estado de subida manual ni reintentos durables implementados. La historia [HU35](https://dbravoo.atlassian.net/browse/RIKDP-46) exige reintentar sin perder captura; no especifica número de intentos, backoff o esquema de cola manual.

## Registro: RecordInspectionInput

Fuentes normativas: [schema.ts](../../apps/web/src/lib/inspections/schema.ts), [service.ts](../../apps/web/src/lib/inspections/service.ts), [rules.ts](../../apps/web/src/lib/inspections/rules.ts).
Origen previsto: navegador → `saveInspection(input)` → `recordInspection` → Prisma. Todos los campos siguientes tienen validación backend implementada, pero su envío desde el inspector HU35 está pendiente.

| Campo | Tipo y obligación | Validación / destino |
| --- | --- | --- |
| `clientId` | UUID opcional | Idempotencia; si falta BD genera id. Existente de otra empresa produce CONFLICT |
| `batchId` | UUID obligatorio | Lote de empresa del actor, estado OPEN → batch_id y contexto molde/pieza |
| `shiftId` | UUID opcional | Si se envía, debe ser turno activo (active=true) de la empresa; no comprueba que su horario cubra capturedAt. Si falta, se resuelve turno por hora/zona de empresa |
| `source` | LINE/CAMERA/BATCH/UPLOAD obligatorio | Manual ADMIN/INSPECTOR sólo no-LINE; STATION sólo LINE. Para HU35 webcam corresponde CAMERA |
| `modelVersion` | string obligatorio, trim, 1–64 | Busca versión en ModelVersion → model_version_id. No UUID aportado por cliente |
| `predictedVerdict` | OK/DEFECTIVE obligatorio | → predicted_verdict y current_verdict inicial |
| `confidence` | number [0,1] obligatorio | → decimal(5,4), redondeo a 4 decimales |
| `thresholdApplied` | number >0 y <1 obligatorio | → decimal(5,4). No contraste con umbral de ModelVersion |
| `imageKey` | string <=200, opcional en esquema | Obligatorio por regla para toda inspección manual; formato/empresa y HEAD R2 verificados → image_key |
| `imageSha256` | 64 hex minúsculas opcional | → image_sha256; no se recalcula ni se compara con R2 |
| `pieceNumber` | entero 1–10 000 000 opcional | Sólo source LINE; no enviar para CAMERA |
| `inferenceMs` | entero 0–60 000 opcional | → inference_ms; resultado local es fraccionario, adaptación manual aún sin implementar |
| `backend` | WEBGL/WASM opcional | → enum de BD; CPU local no tiene representación en enum; no falsear WASM para CPU |
| `warnings` | array máximo 10 strings trim de 1–200 | Default []; → warnings |
| `capturedAt` | fecha coercible obligatoria | Entre now−30 días y now+5 min; → timestamptz(3) |

El servidor deriva `companyId`, `inspectorId`/`stationId`, `moldId`, `partId`, `modelVersionId`, `createdAt`; no se aceptan como sustituto del contexto autenticado. En BD exactamente uno entre inspector y estación identifica autoría. [schema.prisma](../../apps/web/prisma/schema.prisma) mapea `Inspection` → `inspection`, `InspectionEvent` → `inspection_event`, `ModelVersion` → `model_version`. `model_version` debe contener la versión antes del registro; descargar pesos no crea esa fila.

## Respuestas y trazabilidad

`ActionResult<T>` = `{ ok:true, data:T }` o `{ ok:false, code, message }`. `saveInspection` devuelve `data:{ id:string, duplicate:boolean }`; sólo ese éxito confirma persistencia. `requestImageUpload` devuelve ImageUpload en `data`. No hay HTTP status por cada code contractual porque son Server Actions.

Códigos de servicio: `FORBIDDEN`, `INVALID`, `NOT_FOUND`, `BATCH_CLOSED`, `NO_ACTIVE_SHIFT`, `UNKNOWN_MODEL`, `IMAGE_REQUIRED`, `IMAGE_NOT_FOUND`, `STORAGE_NOT_CONFIGURED`, `CONFLICT`. Las acciones agregan `UNAUTHENTICATED` y `UNAVAILABLE`; errores inesperados se registran en servidor y devuelven mensaje genérico. No persistir errores como veredictos.

Registro y evento CREATED son transaccionales. Correcciones mantienen la predicción original y agregan CORRECTED y FLAGGED_FOR_RETRAINING; `currentVerdict` y `correctedAt` son columnas derivadas modificables. No describir toda la fila como absolutamente inmutable. Las restricciones SQL se encuentran en [migración inicial](../../apps/web/prisma/migrations/20261101012122_init/migration.sql).

`getInspectionTrace` consulta por id y empresa, autoriza lectura (ADMIN/INSPECTOR/VIEWER) y devuelve datos con eventos ordenados e `imageUrl` firmada si hay imageKey y storage configurado. Una foto subida sin registro no aparece automáticamente en el historial.

La idempotencia actual considera duplicado un clientId existente de la misma empresa sin comparar su payload. Ante P2002 concurrente el catch también devuelve duplicate; no es una verificación integral de equivalencia de contenido. HU35 aún debe diseñar su gestión de reintentos conforme a este límite, manteniendo captura y contexto originales.

## Contrato exigido pero aún no conectado

HU35 exige selector de cámara, lote/turno activos, resultado con confianza/versión <2 s, imagen R2 y reintento sin perder captura. RIKDP-187–194 no especifican endpoints adicionales ni un DTO de procesamiento. No se agrega un supuesto campo `status`, `error`, `imageId` o `modelName` al contrato real: `imageKey` identifica objeto y `id` identifica registro confirmado. Cualquier contrato futuro debe revisarse explícitamente, incluidas diferencias CPU/enum, redondeo de duración y conservación de JPG original frente al canvas reducido.
