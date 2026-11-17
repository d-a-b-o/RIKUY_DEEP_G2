# HU48 · Hardening de seguridad (RIKDP-59)

## Comportamiento implementado

El proxy protege todas las páginas y endpoints de escritura; los assets de Next y
los binarios WASM se excluyen del proxy. Las cabeceras estáticas se aplican también
a estos assets desde `next.config.ts`.

- CSP con nonce aleatorio de 192 bits por petición. Se sustituyen las cabeceras CSP
  y nonce que envíe el cliente; Next y el script inicial de tema reciben el nonce
  generado. No se permite JavaScript inline sin nonce ni `eval` en producción.
- `wasm-unsafe-eval` permite compilar WebAssembly sin habilitar evaluación arbitraria
  de JavaScript. `worker-src` admite workers propios y blob; WebGL conserva acceso.
- Las conexiones externas se limitan al origen del manifest configurado en
  `NEXT_PUBLIC_MODEL_MANIFEST_URL` y al endpoint de imágenes `R2_ENDPOINT_URL`.
  Si se cambia el origen de publicación, actualizar la variable y redesplegar.
- HSTS de un año, `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  `base-uri 'none'`, `form-action 'self'`, Referrer-Policy y Permissions-Policy.
  Se permite cámara propia; micrófono, geolocalización, pagos y USB están denegados.
  No se activa HSTS includeSubDomains/preload sin controlar todos los subdominios.
- Se oculta `X-Powered-By`.

Los nonces requieren renderizado por petición: se desactivaron Cache Components y
Partial Prefetching, y el layout espera `connection()`. Los documentos se sirven
con `Cache-Control: private, no-store`; cambian los costes y la latencia frente al
prerender previo. Los bundles estáticos mantienen la caché de Next.

## CSRF y orígenes de autenticación

Toda petición distinta de GET/HEAD/OPTIONS requiere un `Origin` exacto de la lista
configurada. Se rechazan `Origin` ausente, `null`, hosts externos y Fetch Metadata
`cross-site` con 403, antes de acceder a la cuota o ejecutar una acción.
Esto cubre también formularios sin JavaScript, sin depender de `Next-Action`.
Next conserva además su validación nativa de Server Actions; no se amplía
`experimental.serverActions.allowedOrigins`. Better Auth mantiene su protección
CSRF nativa y sus cookies de sesión.

Se sustituyó `*.vercel.app` por los hosts concretos configurados mediante
`NEXT_PUBLIC_SITE_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL` y
`VERCEL_PROJECT_PRODUCTION_URL`. No se deriva confianza de Host/X-Forwarded-Host
ni del Origin recibido. En local sin variables se admite localhost:3000.
Para otro puerto u hostname, configurar `NEXT_PUBLIC_SITE_URL` al origen exacto.
Playwright configura el origen de su servidor local en el puerto 3100.

Las llamadas internas del servidor a servicios siguen exigiendo sesión/permisos.
El proxy protege la entrada HTTP; no sustituye la autorización en servicios.

## Límites persistentes de escritura

El login ya tenía límites de Better Auth en base de datos (10 intentos/minuto/IP),
recuperación de contraseña, 2FA y bloqueo por cuenta. Se conserva ese control.
Las otras escrituras tienen cuotas adicionales, sin duplicar el limitador auth:

| Grupo | Cuota por IP | Ventana |
| --- | --- | --- |
| Panel, todas sus acciones | 240 | 1 minuto |
| Aceptación de invitaciones | 10 | 10 minutos |
| Formularios públicos y otras escrituras | 5 | 10 minutos |

Se reutiliza `rate_limit` con el prefijo `hu48-write:`; no se requiere migración.
Un único INSERT ... ON CONFLICT atómico mantiene contador y comienzo de ventana.
Las instancias serverless comparten PostgreSQL. No se guardan IPs en claro: la
clave es SHA-256 de grupo e IP; no incluye IDs de recurso ni valores de formularios.
El exceso devuelve 429 y `Retry-After`. Si no hay base de datos o la consulta falla,
la escritura responde 503; nunca se desactiva silenciosamente la cuota.

Se usa X-Forwarded-For sobrescrito por Vercel. En otro alojamiento el proxy inverso
debe sobrescribirlo y bloquear acceso directo al origen; no confiar en cabeceras
aportadas libremente por clientes. Si falta una IP válida se comparte una cuota
conservadora `unknown`. Las personas detrás de una NAT comparten cuota: ajustar
umbrales tras medir tráfico real, sin eliminar el límite. Mantenimiento opcional
para retirar únicamente filas antiguas de este limitador:

```sql
DELETE FROM rate_limit
WHERE key LIKE 'hu48-write:%'
  AND last_request < (extract(epoch FROM now()) * 1000)::bigint - 86400000;
```

## Evidencia y reproducción

Los reportes de esta implementación están en [evidencias/RIKDP-59](evidencias/RIKDP-59/).

- Lint, tipos y build de producción correctos.
- 42 pruebas Vitest: políticas, proxy, regresión de acceso/autenticación y una prueba
  de cuota SQL. Bajo 20 solicitudes concurrentes solo se admiten 5; la ventana se
  reinicia al vencer. Localmente se usó PostgreSQL WASM (PGlite) efímero a través de
  su protocolo TCP; CI ejecuta la misma prueba contra PostgreSQL 16.
- 3 pruebas Chromium: nonce distinto por documento, script malicioso insertado en
  el HTML bloqueado, hidratación y selector de tema funcionales, operaciones reales
  TensorFlow.js `[1,2] + [3,4]` en WASM y WebGL, CSRF 403 y cuota HTTP 429.
  Se incluyen en `@smoke`; la prueba de IP controlada se limita al harness local.
- ZAP 2.17.0 Automation Framework, spider y escáner pasivo, sin active scan ni
  sesión autenticada: 53 URLs locales, cero hallazgos altos. JSON y HTML adjuntos.
- npm audit: producción sin vulnerabilidades; árbol completo con cero altas o
  críticas y nueve paquetes con alertas moderadas de tooling de desarrollo.

Comandos desde `apps/web` (base de pruebas aislada y migrada en DATABASE_URL):

```sh
npm run lint
npm run typecheck
npm test -- src/lib/security src/proxy.test.ts src/lib/auth/config.test.ts src/lib/authz/route-access.test.ts
npm run build
npx playwright test e2e/security.spec.ts --project chromium --workers 1
npm audit --omit=dev --audit-level=high
```

El SQL de pruebas elimina su propia clave aleatoria; no usar bases de producción.
El probe HTTP usa una ruta inexistente para evitar escrituras de negocio.

### Alertas medias y alcance pendiente

ZAP observa `style-src unsafe-inline`: se permite CSS inline porque React usa
atributos style. No se permite JavaScript inline sin nonce. Retirar esta excepción
requiere migrar esos estilos, sin relajar `script-src`.
ZAP también detecta ausencia de tokens anti-CSRF en formularios: el control aplicado
es validación estricta de Origin/Fetch Metadata más Next/Better Auth; las pruebas
HTTP negativas están adjuntas. No se han ocultado estas alertas del reporte.

El baseline local HTTP no acredita TLS/HSTS en la infraestructura ni cobertura de
pantallas privadas. Antes de cerrar HU48, desplegar esta rama en preview HTTPS,
comprobar cabeceras y cámara real, repetir DAST y las pruebas autenticadas con datos
de prueba, y adjuntar ese reporte. Solo entonces activar `DAST_ENFORCE_HIGH=true`
y exigir el estado DAST de HU51 en la protección de main. Esta implementación no
modifica secretos, variables remotas, protección de ramas ni estados de Jira.

Referencias: [CSP en Next](https://nextjs.org/docs/app/guides/content-security-policy),
[seguridad Better Auth](https://better-auth.com/docs/reference/security),
[cabeceras Vercel](https://vercel.com/docs/headers/request-headers),
[ZAP Automation Framework](https://www.zaproxy.org/docs/desktop/addons/automation-framework/).

## Validación HTTPS de la preview (16 de noviembre de 2026)

La preview asociada al commit `5aebd5fd3293d6b9e59346fff8f2dde098370adb` de
[PR #78](https://github.com/d-a-b-o/RIKUY_DEEP_G2/pull/78) presenta un certificado
válido para su hostname, con cadena de confianza verificada. Se comprobaron
conexiones TLS 1.3 y TLS 1.2, y redirección HTTP → HTTPS con código 308.
El certificado observado vence el 29 de enero de 2027.

Todas las rutas HTTPS comprobadas (`/`, `/ingresar`, `/panel`) redirigen al SSO de
Vercel mediante Deployment Protection. La respuesta del perímetro incluye HSTS,
pero no acredita las cabeceras emitidas por nuestra aplicación ni el acceso al
panel. La CSP y las pantallas autenticadas en preview siguen pendientes hasta
contar con una sesión autorizada o el bypass de automatización. No se desactivó
Deployment Protection ni se ignoró la validación TLS.

Evidencia: [https-preview.json](evidencias/RIKDP-59/https-preview.json).

## Validación autenticada en producción (16 de noviembre de 2026)

En `https://rikuydeep.vercel.app` se validaron el certificado real, TLS 1.3,
redirección HTTP 308 y cabeceras de la aplicación. Con una cuenta INSPECTOR se
comprobaron seis pantallas permitidas (200), tres rutas restringidas (403), cookies
de sesión seguras y cierre de sesión con invalidación. Los diez documentos de la
revisión directa usan nonces distintos y no se observaron errores de JavaScript
ni bloqueos de CSP.

ZAP 2.17.0 completó un escaneo pasivo autenticado: cero reglas con alerta alta,
tres medias y cuatro informativas. Las medias corresponden al formulario público
sin token CSRF reconocido por ZAP, `style-src unsafe-inline` y CORS en recursos
estáticos públicos. Se conservan las alertas y su evaluación; el escaneo pasivo no
demuestra explotación ni ausencia de vulnerabilidades.

La cuenta no tiene 2FA activado. Esta revisión no acredita el flujo 2FA, recuperación
por correo, cámara física, otros roles ni pruebas de escritura. Tampoco sustituye
la validación de la preview protegida, la rotación de secretos o la activación del
gate DAST y la protección de main.

Resultados, alcance e informes: [validación de producción](evidencias/RIKDP-59/production/README.md).
