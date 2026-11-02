# Modelo de datos multiempresa

Modelo entidad-relación de RikuyDeep. Es la base del esquema Prisma que se creará en HU13 (RIKDP-24).

Tarea: RIKDP-87 (HU07-T02 · modelo entidad-relación multiempresa), dentro de HU08 · Crear la aplicación web.

Decisiones relacionadas: [ADR 0003 · multiempresa con `company_id`](../adr/0003-multiempresa-con-columna-company-id.md), [ADR 0004 · trazabilidad inmutable](../adr/0004-trazabilidad-inmutable.md) y [ADR 0007 · estación de inspección automática](../adr/0007-estacion-de-inspeccion-automatica.md).

## Convenciones

- Tablas y columnas en inglés y `snake_case`: Better Auth exige nombres en inglés para sus tablas (`user`, `session`, `account`, `verification`, `two_factor`), y así todo el esquema queda homogéneo. En Prisma, los modelos van en `PascalCase` con `@@map`.
- Claves primarias `id` de tipo texto (UUID v7 o cuid2, según lo que genere Better Auth).
- Fechas en UTC (`timestamptz`). La zona horaria de cada planta se guarda en `company.timezone` para calcular turnos y reportes.
- Toda tabla de negocio lleva `company_id`. Las únicas tablas sin empresa son las de plataforma: `lead`, `model_version` y las internas de Better Auth.

## Diagrama

```mermaid
erDiagram
  company ||--o{ user : "emplea"
  company ||--o{ invitation : "invita"
  company ||--o{ part : "fabrica"
  company ||--o{ mold : "posee"
  company ||--o{ shift : "organiza"
  company ||--o{ batch : "produce"
  company ||--o{ inspection : "registra"
  company ||--o{ inspection_event : "audita"
  company ||--o{ station : "instala"

  user ||--o{ session : "abre"
  user ||--o{ account : "se autentica con"
  user ||--o| two_factor : "configura"
  user ||--o{ invitation : "envía"
  user ||--o{ inspection : "inspecciona"
  user ||--o{ inspection_event : "actúa en"
  user |o--o{ access_denied_log : "provoca"
  user |o--o| station : "cuenta técnica de"

  part ||--o{ mold : "se moldea en"
  mold ||--o{ batch : "se usa en"
  batch ||--o{ inspection : "contiene"
  shift ||--o{ inspection : "durante"
  station ||--o{ inspection : "registra"
  batch |o--o{ station : "lote asignado"
  mold ||--o{ inspection : "instantánea"
  part ||--o{ inspection : "instantánea"
  model_version ||--o{ inspection : "evalúa"
  model_version |o--o{ model_telemetry : "mide"
  inspection ||--|{ inspection_event : "historial"

  company {
    text id PK
    text name
    text tax_id UK "RUC, opcional"
    enum status "ACTIVE | INACTIVE"
    boolean require_two_factor
    text timezone "p. ej. America/Lima"
    decimal batch_reject_threshold "porcentaje máximo de defectuosas para liberar un lote"
    timestamptz created_at
    timestamptz updated_at
  }

  user {
    text id PK
    text company_id FK "nulo solo para SUPERADMIN"
    text name
    text email UK
    boolean email_verified
    enum role "SUPERADMIN | ADMIN | INSPECTOR | VIEWER | STATION"
    boolean active
    boolean two_factor_enabled
    int failed_login_count
    timestamptz locked_until
    timestamptz created_at
    timestamptz updated_at
  }

  session {
    text id PK
    text user_id FK
    text token UK
    timestamptz expires_at
    text ip_address
    text user_agent
  }

  account {
    text id PK
    text user_id FK
    text provider_id "credential"
    text account_id
    text password "hash"
  }

  verification {
    text id PK
    text identifier "p. ej. reset-password:email"
    text value "token de un solo uso"
    timestamptz expires_at
  }

  two_factor {
    text id PK
    text user_id FK
    text secret "cifrado"
    text backup_codes "cifrados, un solo uso"
  }

  invitation {
    text id PK
    text company_id FK
    text email
    enum role
    text token_hash UK
    text invited_by_id FK
    timestamptz expires_at
    timestamptz accepted_at
  }

  part {
    text id PK
    text company_id FK
    text code "UK por empresa"
    text name
    text description
    boolean active
  }

  mold {
    text id PK
    text company_id FK
    text part_id FK
    text code "UK por empresa"
    int cavities
    boolean active
  }

  shift {
    text id PK
    text company_id FK
    text name
    time start_time
    time end_time "menor que start_time si cruza medianoche"
    boolean active
  }

  batch {
    text id PK
    text company_id FK
    text mold_id FK
    text code "UK por empresa"
    enum status "OPEN | CLOSED"
    text opened_by_id FK
    timestamptz opened_at
    timestamptz closed_at
  }

  station {
    text id PK
    text company_id FK
    text user_id FK "cuenta técnica, rol STATION"
    text name "p. ej. Línea 2 · Estación 1"
    text line "línea de producción"
    text current_batch_id FK "lote abierto asignado"
    jsonb config "umbrales de detección, okPhotoEvery, ritmo"
    boolean active
    timestamptz last_seen_at "último latido"
  }

  model_version {
    text id PK
    text version UK "semver, p. ej. 1.2.0"
    text artifact_path "models/v1.2.0/model.json en R2"
    int input_size
    decimal decision_threshold
    decimal recall_defective
    decimal accuracy
    text mlflow_run_id
    timestamptz published_at
  }

  inspection {
    text id PK
    text company_id FK
    text batch_id FK
    text shift_id FK
    text mold_id FK "instantánea"
    text part_id FK "instantánea"
    text inspector_id FK "nulo si la registró una estación"
    text station_id FK "nulo en inspecciones manuales"
    int piece_number "correlativo de la estación en el turno"
    text model_version_id FK
    enum source "LINE | CAMERA | BATCH | UPLOAD"
    enum predicted_verdict "OK | DEFECTIVE"
    decimal confidence
    decimal threshold_applied
    text image_key "clave en R2, nulo si no se guardó foto"
    text image_sha256
    int inference_ms
    enum backend "WEBGL | WASM"
    text warnings "MOTION, COUNT_UNCERTAIN"
    timestamptz captured_at
    timestamptz created_at
    enum current_verdict "derivada"
    timestamptz corrected_at "derivada"
  }

  inspection_event {
    text id PK
    text company_id FK
    text inspection_id FK
    enum type "CREATED | CORRECTED | FLAGGED_FOR_RETRAINING"
    enum previous_verdict
    enum new_verdict
    text reason "obligatorio en CORRECTED"
    text actor_id FK
    timestamptz created_at
  }

  lead {
    text id PK
    text name
    text email
    text company_name
    text phone
    text message
    enum status "NEW | CONTACTED | DISCARDED"
    timestamptz created_at
  }

  access_denied_log {
    text id PK
    text user_id FK
    text company_id
    text method
    text path
    text action
    text ip_hash
    timestamptz created_at
  }

  model_telemetry {
    text id PK
    text company_id
    text model_version_id FK
    enum type "INFERENCE | LOAD_ERROR"
    int duration_ms
    enum backend
    text message
    timestamptz created_at
  }
```

## Diccionario de entidades

| Entidad | Qué representa | Historias |
| --- | --- | --- |
| `company` | Empresa cliente (planta de fundición). Una empresa `INACTIVE` no puede iniciar sesión. Puede exigir 2FA a sus usuarios | HU23, HU29 |
| `user` | Usuario con un rol. `company_id` es nulo solo para el superadministrador. `failed_login_count` y `locked_until` implementan el bloqueo tras 5 intentos fallidos. El rol `STATION` es la cuenta técnica de una estación, no una persona | HU19, HU30, HU32, HU44 |
| `session`, `account`, `verification`, `two_factor` | Tablas de Better Auth: sesiones, credenciales (hash de contraseña), tokens de un solo uso (recuperación, 30 min) y secreto TOTP con códigos de respaldo | HU19, HU20, HU29 |
| `invitation` | Invitación por correo para que un usuario cree su contraseña en una empresa con un rol | HU23, HU30 |
| `part` | Pieza que fabrica la empresa | HU31 |
| `mold` | Molde con el que se fabrica una pieza | HU31 |
| `shift` | Turno con horario. Si `end_time < start_time`, cruza la medianoche | HU31 (HU33) |
| `station` | Estación de inspección automática: un computador con cámara en un punto de una línea. Tiene su cuenta técnica, su lote asignado y su configuración de detección. `last_seen_at` permite saber si está en marcha | HU44 |
| `batch` | Lote de producción, hecho con un molde. Estado abierto o cerrado. Solo se inspecciona en lotes abiertos | HU31 (HU33), HU39 |
| `model_version` | Versión publicada del modelo, con sus métricas y el run de MLflow. La versión activa la decide el `manifest.json` en R2 | HU25, HU26 |
| `inspection` | Registro inmutable de una inspección. Guarda una instantánea de molde y pieza, para que el historial no cambie si después se edita un catálogo. La registra una persona (`inspector_id`) o una estación (`station_id`). Solo tiene foto si es defectuosa o forma parte de la muestra de OK | HU24, HU35, HU39, HU44 |
| `inspection_event` | Historial de la inspección: creación, correcciones con motivo y marca para reentrenamiento | HU24, HU40 |
| `lead` | Solicitud de demo desde la landing | HU14 |
| `access_denied_log` | Registro de cada acceso no autorizado (403) | HU32 |
| `rate_limit` | Contadores del rate limit de Better Auth por IP y ruta. Se añadió en la migración `auth_rate_limit` | HU19 |
| `model_telemetry` | Tiempos de inferencia y errores de carga del modelo reportados por el navegador | HU43 |

## Reglas de negocio que el esquema debe garantizar

1. **Aislamiento por empresa.** Todas las consultas de negocio filtran por el `company_id` de la sesión. Las claves de negocio son únicas por empresa: `UNIQUE (company_id, code)` en `part`, `mold` y `batch`.
2. **Coherencia entre empresas.** Un `mold` y su `part`, un `batch` y su `mold`, y una `inspection` con su lote, turno e inspector pertenecen a la misma empresa. Se valida en la capa de datos y con pruebas de aislamiento (RIKDP-173, RIKDP-265).
3. **Inmutabilidad.** `inspection` e `inspection_event` no admiten `DELETE`; `inspection` solo permite actualizar las columnas derivadas `current_verdict` y `corrected_at`, en la misma transacción que el evento `CORRECTED` ([ADR 0004](../adr/0004-trazabilidad-inmutable.md)).
4. **Corrección.** Un evento `CORRECTED` exige `reason`, y `new_verdict` distinto del vigente. Toda corrección genera también `FLAGGED_FOR_RETRAINING` (HU40).
5. **Turno activo.** Para una hora local `h` de la empresa, un turno está activo si `start_time <= h < end_time`, o, cuando cruza la medianoche (`end_time < start_time`), si `h >= start_time` o `h < end_time`.
6. **Lote.** Solo se registran inspecciones en lotes `OPEN`. Al cerrarse, el resumen compara el porcentaje de defectuosas con `company.batch_reject_threshold` para recomendar liberar o rechazar (HU39).
7. **Superadministrador.** `role = SUPERADMIN` si y solo si `company_id` es nulo. Siempre con 2FA (HU29).
8. **Autor de la inspección.** Exactamente uno de `inspector_id` y `station_id` tiene valor. Con `source = LINE`, es `station_id`.
9. **Fotos.** `image_key` es obligatorio si `predicted_verdict = DEFECTIVE`. En las OK de una estación, solo 1 de cada `config.okPhotoEvery`. Las inspecciones manuales (HU35, HU39) siempre guardan foto.
10. **Cuenta de estación.** Un usuario con rol `STATION` solo puede registrar inspecciones de su estación; no accede al dashboard ni a la administración.

## Índices previstos

Pensados para el dashboard (HU37: menos de 2 s con 10 000 inspecciones) y el historial (HU40):

| Tabla | Índice | Para |
| --- | --- | --- |
| `inspection` | `(company_id, captured_at DESC)` | Historial y tendencia diaria |
| `inspection` | `(company_id, station_id, captured_at)` | Contadores de la estación y KPIs por estación |
| `inspection` | `(company_id, batch_id)` | Resumen de lote |
| `inspection` | `(company_id, shift_id, captured_at)` | KPIs y reporte por turno |
| `inspection` | `(company_id, mold_id, current_verdict)` | Ranking de moldes con más defectos |
| `inspection_event` | `(inspection_id, created_at)` | Detalle de una inspección |
| `inspection_event` | `(company_id, type, created_at)` | Exportar imágenes para reentrenamiento |
| `user` | `(company_id, role)` | Listado de usuarios por empresa |

### Volumen

Con estaciones automáticas, cada una registra unas 28 800 inspecciones por turno de 8 horas a 1 pieza por segundo; una planta con 2 estaciones y 3 turnos, unas 170 000 al día. Los índices de arriba bastan para el historial paginado. Para los KPIs del dashboard (HU37) se añadirá una tabla de agregados por hora, estación, molde y veredicto, actualizada en la misma transacción que cada lote de inspecciones, de modo que el dashboard no recorra las inspecciones una a una.

## Roles

Resumen de la matriz de permisos de HU32. El detalle por acción se implementa en RIKDP-179.

| Rol | Alcance |
| --- | --- |
| `SUPERADMIN` | Plataforma: empresas, leads, monitoreo y versiones del modelo |
| `ADMIN` | Su empresa: usuarios, catálogos, lotes, turnos, dashboard y reportes |
| `INSPECTOR` | Su empresa: inspeccionar, corregir veredictos y ver el historial |
| `VIEWER` | Su empresa: solo lectura de dashboard, historial y reportes |
| `STATION` | Cuenta técnica de una estación: registrar inspecciones de esa estación y leer su configuración |
