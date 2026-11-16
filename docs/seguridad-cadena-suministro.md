# HU51 · Cadena de suministro y despliegue seguros

Implementación de RIKDP-282 a RIKDP-286. Los controles no sustituyen HU48.

## Preview y ZAP

`dast-preview.yml` escucha `deployment_status` exitoso de Vercel en `Preview`.
Debe estar fusionado en la rama predeterminada para recibir estos eventos.
Configurar la variable GitHub `DAST_VERCEL_PROJECT` con el slug exacto del proyecto.
Solo admite HTTPS en un host `<slug>-*.vercel.app`, sin credenciales, puerto ni query.
Comprueba que la PR esté abierta, tenga ese SHA y provenga del mismo repositorio.
Las PR de forks no reciben el bypass ni ejecutan código con secretos.
El checkout siempre carga la rama predeterminada, nunca la rama de la PR.

Si Deployment Protection está activo, guardar el bypass de automatización de Vercel
como `VERCEL_AUTOMATION_BYPASS_SECRET` en GitHub Actions. ZAP lo envía únicamente al
origen validado mediante un replacer; no se incluye en la URL ni en los artefactos.
El archivo temporal con el secreto se elimina tras el escaneo. La imagen ZAP está
fijada por digest: actualizarla explícitamente tras revisar una nueva versión.

El reporte HTML/JSON se conserva 30 días. El estado `HU51 / DAST preview` aparece
sobre el commit de la PR y enlaza al resumen y artefactos. Es un baseline sin login:
no acredita cobertura de páginas autenticadas ni reemplaza las pruebas de HU48.
Los fallos operativos y reportes incompletos fallan incluso en modo informativo.
Los hallazgos inicialmente solo informan: HU48 (RIKDP-59) sigue pendiente.
Al cerrar HU48, configurar `DAST_ENFORCE_HIGH=true` y exigir el estado DAST en la
protección de main; los hallazgos de riesgo >= 3 entonces bloquean.
Validar primero una preview limpia y una con un hallazgo alto conocido.

## SBOM

Tras finalizar correctamente CI para un push a `main`, `sbom.yml` inventaría el
SHA exacto que se validó. npm genera CycloneDX con el árbol web instalado, sin
scripts de instalación. Para ML se resuelven por separado los cuatro requirements
(ci, publish, regression y train), evitando mezclar entornos incompatibles.
CycloneDX inventaría los paquetes realmente instalados y sus transitivas;
`resolved-requirements.txt` conserva las versiones resueltas. Los artefactos llevan
el SHA y se retienen 90 días; descargar los asociados al despliegue investigado.
Ante un aviso CVE/GHSA, buscar nombre/purl y versión afectada en `components`,
identificar los entornos afectados y actualizar sus manifests mediante Dependabot.
Los SBOM no demuestran ausencia de vulnerabilidades: las auditorías de CI continúan.
Herramienta Python declarada en `.github/requirements-sbom.txt` para Dependabot.

## Workflows

Todas las actions externas están fijadas por SHA con versión comentada; Dependabot
ya cubre `github-actions` en `/`. Los checkouts no persisten credenciales.
Los jobs declaran permisos explícitos. CodeQL requiere `security-events: write`,
la revisión de dependencias usa escritura de PR y DAST escribe estados del commit.
No usar `pull_request_target` para ejecutar código de PR ni habilitar el envío de
secretos a forks. Mantener aprobación de ejecuciones de colaboradores externos.
HU22 se filtra por ML, modelos, golden, DVC, notebook y su propio workflow.

## Inventario de secretos y responsables de acceso

No registrar valores ni capturas que los revelen. Acceso efectivo a revisar por el
administrador: esta tabla describe los roles autorizados, no audita miembros actuales.

| Secreto | Ubicación | Quién necesita acceso | Rotación y comprobación |
| --- | --- | --- | --- |
| BETTER_AUTH_SECRET | Vercel por entorno; .env.local en desarrollo | Administradores Vercel y desarrollador local | Generar 32 bytes aleatorios; actualizar y redesplegar. Probar login y recuperación. Invalida sesiones y puede afectar secretos TOTP/códigos cifrados: planificar recuperación/reinscripción 2FA antes de revocar el anterior. |
| DATABASE_URL, DIRECT_URL, DATABASE_URL_UNPOOLED | Vercel y .env.local, credenciales Neon por entorno | Administradores Neon/Vercel | Crear rol/contraseña nueva con permisos mínimos, actualizar conexiones pool/directa, redesplegar y probar consulta/migración en preview; revocar rol anterior tras validar. |
| RESEND_API_KEY | Vercel; local solo si se necesita correo | Administradores Resend/Vercel | Crear clave de envío para el dominio, actualizar, redesplegar, enviar correo de prueba y revocar la anterior. |
| R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (modelos) | Secretos Colab, nunca navegador/Vercel | Publicadores del modelo y administradores Cloudflare | Crear token Object Read & Write limitado al bucket de modelos, actualizar Colab, publicar versión de prueba y validar hashes; revocar token anterior y comprobar rechazo. |
| R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (imágenes) | Vercel por entorno | Administradores Cloudflare/Vercel | Token distinto, limitado al bucket privado; actualizar, redesplegar, probar subida/lectura firmada y revocar anterior. |
| VERCEL_AUTOMATION_BYPASS_SECRET | Vercel y GitHub Actions | Administradores Vercel/GitHub | Regenerar bypass, actualizar secreto GitHub, validar ZAP en preview protegida y comprobar rechazo del anterior. |
| GITHUB_TOKEN | Efímero, emitido por Actions | Solo job autorizado | GitHub lo renueva por ejecución; no almacenar PAT como sustituto. |

R2_ENDPOINT_URL, R2_MODELS_BUCKET y R2_IMAGES_BUCKET identifican recursos: no son
credenciales, pero deben corresponder al entorno y al ámbito del token.
Dar acceso Colab únicamente a notebooks confiables; no ejecutar notebooks de forks
con acceso a secretos. Retirar accesos al salir un integrante del equipo.

### Evidencia de rotación real (pendiente)

Todavía no se ha ejecutado una rotación en un proveedor desde esta implementación.
Para completar RIKDP-285, un administrador debe registrar fecha UTC, proveedor,
entorno, responsable, identificador no sensible del token, prueba positiva con el
nuevo token y prueba negativa con el revocado, más enlace al reporte sin secretos.
No marcar HU51 como aceptada hasta adjuntar esa evidencia.

## Activación del modelo

El publicador captura los bytes ligados al quality gate, sube objetos inmutables,
y vuelve a descargarlos desde R2 antes de escribir `manifest.json`. Compara SHA-256
de model.json, todos los shards, preprocessing.json y quality_gate.json. El hash de
model.json sigue en el manifest. Una diferencia aborta sin activar la versión;
`publication-report.json` en el directorio del run conserva hashes esperados/reales.
La activación conserva el control de concurrencia por ETag y el segundo quality gate.
El notebook Colab embebe exactamente el publicador probado. El dry-run no usa R2.
Las pruebas locales simulan corrupción remota; falta acreditar una publicación real
con el reporte descargado de R2 como evidencia operativa de RIKDP-286.

Referencias: [ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/),
[CycloneDX Python](https://cyclonedx-bom-tool.readthedocs.io/en/stable/usage.html).
