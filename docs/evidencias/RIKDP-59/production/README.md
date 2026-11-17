# Validación de producción — 16 de noviembre de 2026

Destino: https://rikuydeep.vercel.app. Validación real con la cuenta de prueba
proporcionada por el responsable, mediante Chromium y OWASP ZAP 2.17.0.
No se guardaron credenciales, cookies de sesión, HTML privado ni capturas de datos.

## Resultados

- Certificado válido: cadena y hostname verificados, TLS 1.3, vencimiento observado
  el 29 de enero de 2027. HTTP redirige a HTTPS con 308.
- HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy y
  Permissions-Policy presentes. Diez documentos de la revisión directa contienen
  diez nonces diferentes. No se observaron errores JavaScript ni errores CSP
  durante esa revisión.
- Inicio de sesión correcto con rol INSPECTOR. Cookie de sesión Secure, HttpOnly
  y SameSite=Lax.
- Seis rutas autorizadas responden 200: `/panel`, `/panel/cuenta/seguridad`,
  `/panel/catalogos`, `/panel/dashboard`, `/panel/inspecciones` y
  `/panel/inspeccion`.
- Tres rutas restringidas responden 403: `/panel/reportes`,
  `/panel/admin/usuarios` y `/panel/admin/empresas`. Los nueve resultados coinciden
  con los permisos del rol definidos en el código revisado.
- Cierre de sesión correcto e invalidación de la sesión comprobada.
- Escaneo pasivo autenticado sobre las seis rutas permitidas, `/` e `/ingresar`.
  Se confirmó que la sesión del navegador que generó el tráfico seguía autenticada.
  Resultado por tipo de regla: 0 altas, 3 medias, 0 bajas y 4 informativas.

## Hallazgos para revisión

Los hallazgos se conservan en el informe original; no se han suprimido.

| Alerta media | Evidencia y evaluación |
| --- | --- |
| Absence of Anti-CSRF Tokens | Formulario público de `/`. La ausencia de un campo reconocido por ZAP no demuestra por sí sola que pueda explotarse CSRF. El proyecto aplica controles de Origin/Fetch Metadata y del framework; esta corrida pasiva no ejercitó un POST adversario en producción. |
| CSP: style-src unsafe-inline | Excepción de CSS documentada para los estilos de React. `script-src` sigue usando nonce y strict-dynamic. La excepción sigue presente y requiere una decisión documentada para el cierre. |
| Cross-Domain Misconfiguration | Tres instancias de `Access-Control-Allow-Origin: *` en JavaScript y una fuente públicos bajo `/_next/static/immutable/`. Las instancias observadas no corresponden a APIs privadas; no acreditan filtración de información autenticada. |

Las cuatro reglas informativas corresponden a comentarios en bundles, directivas
de caché (`no-store` en la respuesta de sesión), caché de recursos estáticos e
identificación de la respuesta de sesión. Su clasificación es la emitida por ZAP.

## Alcance y límites

Es evidencia de **producción**, no de la preview protegida por SSO de Vercel.
El SHA `expectedMainCommit` del JSON es una referencia esperada de main; no se
verificó que el despliegue sirviera exactamente ese commit.

Se comprobó navegación, respuestas, cabeceras y permisos de este rol. No se
realizaron escrituras de negocio ni pruebas funcionales completas de cada pantalla.
No se activó 2FA (la cuenta no lo tiene activo), no se probó recuperación por correo,
ni cámara física, ni otros roles. Un escaneo pasivo sin alertas altas no garantiza
ausencia de vulnerabilidades y no sustituye un análisis activo.

La contraseña se usó antes de conectar el navegador al proxy de ZAP. Solo el
navegador del escaneo aceptó la CA temporal del proxy local; la revisión directa
de navegador y la prueba TLS verificaron el certificado real. Los datos temporales
del escáner se eliminaron después de cerrar la sesión.

Esta validación no acredita la rotación de secretos, la protección de main ni la
activación del bloqueo DAST en CI. No se cambiaron ajustes de seguridad ni estados
de Jira.

## Archivos

- [https.json](https.json): certificado, TLS, redirección y cabeceras públicas.
- [authenticated-ui.json](authenticated-ui.json): resultados por ruta, permisos,
  cookies sin valores, estado del escaneo y cierre de sesión.
- [zap-authenticated.json](zap-authenticated.json): informe pasivo con evidencias
  de las alertas y valores de sesión eliminados.
