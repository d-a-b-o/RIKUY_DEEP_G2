# HU50-T02 · Búsqueda de secretos (RIKDP-278)

## Alcance

CI invoca `.github/workflows/gitleaks.yml` sin filtros de rutas:

- En cada PR analiza los commits entre `base.sha` y `head.sha`.
- En pushes a `main` y ejecuciones manuales de CI analiza el historial completo
  alcanzable por las referencias descargadas (`--all --full-history`).
- El checkout usa `fetch-depth: 0`. No requiere PAT, credenciales de aplicación
  ni licencia de Gitleaks Action: ejecuta directamente la CLI oficial 8.30.1.
- La descarga Linux se verifica con un SHA-256 fijo antes de ejecutar el binario.
- Un hallazgo hace fallar Gitleaks y el job final **CI**, que ya depende de él.
  CI debe estar configurado como obligatorio en la protección de `main` para
  impedir la fusión. Esa configuración de GitHub no se modifica desde YAML.

Los reportes JSON ocultan los valores detectados (`--redact=100`) y se conservan
durante 7 días como artefacto `gitleaks-report`. No se permite omitir hallazgos
con comentarios `gitleaks:allow`. El reporte todavía contiene rutas y commits.

## Exclusiones pendientes de aprobación

`.gitleaks.toml` hereda las reglas estándar. `.gitleaksignore` contiene solamente
dos huellas exactas propuestas para revisión:

| Ubicación histórica | Motivo |
| --- | --- |
| `.github/workflows/ci.yml`, commit `839187102256`, línea 65 | `BETTER_AUTH_SECRET` ficticio, identificado en el propio workflow como exclusivo de la base efímera de CI. |
| `apps/web/src/lib/auth/auth.test.ts`, mismo commit, línea 236 | Dato de prueba de recuperación de contraseña usado para comprobar el rechazo de un token reutilizado. |

Estas excepciones limitan la omisión a commit, archivo, regla y línea. No excluyen
archivos completos ni futuras credenciales añadidas en ellos. No constituyen una
aprobación: el responsable debe revisar contexto y huellas en la PR antes de fusionar.
No agregar un hallazgo real a las exclusiones para hacer pasar CI.

## Escaneo inicial local · 2026-11-03

Se ejecutó Gitleaks 8.30.1 en Windows, verificando el checksum del archivo oficial,
sobre un repositorio no superficial con **96 commits alcanzables** y HEAD
`b9834b5776f922cf326772c09d91f39595b9920a`.

1. Sin exclusiones: dos hallazgos `generic-api-key`, en las ubicaciones anteriores.
2. Con las dos huellas propuestas: cero hallazgos restantes, salida 0.
3. Prueba funcional en un repositorio temporal: un token sintético con formato
   GitHub PAT se añadió y eliminó en dos commits. El escaneo histórico lo detectó
   y devolvió salida 1; el valor no apareció en consola ni en el JSON.
4. Un rango vacío de commits devolvió salida 0.
5. Se validó la sintaxis YAML/TOML y la dependencia de Gitleaks en el job CI.

Los reportes locales están bajo `reports/hu50/`, ignorado por Git:
`gitleaks-history-initial.json` y `gitleaks-history-reviewed.json` (este segundo
nombre identifica la ejecución con exclusiones propuestas, todavía no aprobadas).
El resumen versionado está en `docs/evidencias/RIKDP-278-gitleaks.json`.

Este resultado cubre las referencias disponibles en el clon local; no se hizo
fetch remoto en esta entrega ni se garantiza cobertura de ramas borradas,
objetos inalcanzables, forks o archivos fuera de Git. Tampoco se ejecutó aún
el workflow en GitHub. No se identificó un secreto real que requiriera rotación
en los hallazgos obtenidos; la clasificación de datos de prueba debe revisarse.

## Reproducir localmente

Instalar la CLI oficial **8.30.1**, verificar su checksum y ejecutar desde la raíz:

```sh
gitleaks git . --log-opts="--all --full-history" --config=.gitleaks.toml --gitleaks-ignore-path=.gitleaksignore --ignore-gitleaks-allow --redact=100 --report-format=json --report-path=reports/hu50/gitleaks-history-reviewed.json
```

Crear previamente `reports/hu50/`. Una salida distinta de cero requiere revisar
el resultado; no asumir que todo error es un secreto. Para verificar todos los
refs remotos actuales, actualizar primero el clon con autorización y volver a
ejecutar el escaneo. Después de publicar el workflow también se puede ejecutar
**Actions → CI → Run workflow** para obtener evidencia remota del historial.

## Secret scanning y push protection · pendiente en GitHub

El repositorio es público y puede usar secret scanning y push protection.
Esta entrega es exclusivamente local: no se consultó ni cambió su estado de
activación. Un administrador debe abrir **Settings → Code security / Secret
Protection**, verificar que **Secret scanning** y **Push protection** estén
habilitados y guardar evidencia sin valores de secretos. La conexión utilizada
en la revisión previa no tenía permisos de administración.

GitHub push protection y Gitleaks son controles complementarios. La existencia
del workflow no demuestra que push protection esté activo.

## Si se encuentra una credencial real

1. Identificar el servicio y avisar al responsable por un canal autorizado,
   sin copiar la credencial en issues, comentarios o reportes públicos.
2. Revocar o rotar en el proveedor y actualizar los consumidores afectados
   (por ejemplo Vercel, Colab o GitHub). Comprobar que la anterior ya no funciona.
3. Retirar el valor del código; eliminar el archivo actual no elimina el historial.
   Coordinar cualquier limpieza del historial por separado.
4. Registrar proveedor, responsable, fecha, revocación y verificación sin valores.
   Mantener la tarea abierta hasta confirmar la rotación y revisar el historial.

RIKDP-285 cubre el inventario general y la guía de rotación. RIKDP-281 cubre la
guía común de hallazgos, Definition of Done y plan de pruebas. Esta entrega solo
añade la dependencia técnica de Gitleaks necesaria para que CI propague su fallo.

## Pendiente para cerrar

- Aprobar o corregir las dos exclusiones en revisión.
- Ejecutar el workflow real y adjuntar el resultado.
- Verificar push protection y el check CI obligatorio en GitHub.
- Rotar cualquier secreto real que se identifique durante la revisión.

Referencias: [CLI de Gitleaks](https://github.com/gitleaks/gitleaks/tree/v8.30.1),
[release y checksums](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
[push protection en repositorios públicos](https://github.blog/changelog/2023-05-09-secret-scannings-push-protection-is-available-on-public-repositories-for-free/).
