# RIKDP-145 · Rechazo del modelo degradado en GitHub Actions

Resultado verificado el 15/11/2026 (America/Lima). Ambos ensayos ejecutaron
`HU22 model regression` en `main`, commit `f0527ac7e58f28f1e8e63035b90bf5eb38a337b2`.

| Caso | Ejecución | Resultado del gate real |
| --- | --- | --- |
| Normal, `degraded=false` | [43783014384](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/43783014384) | Aprobado; 0 discrepancias en 50 imágenes. Ambos jobs finalizaron correctamente. |
| Degradado, `degraded=true` | [43781489981](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/43781489981) | Rechazado; 25 discrepancias y salida 1. La verificación del motivo aprobó. El estado rojo es intencional. |

El caso degradado contiene [verification.json](degraded/pt1-negative/verification.json)
con `passed: true` y `gate_exit_code: 1`. Su
[reporte de regresión](degraded/regression/regression.json) tiene alcance
`real_keras_baseline_vs_candidate`; se validó con `verify_rejection`.
El [reporte normal](normal/regression/regression.json) tiene el mismo alcance y `passed: true`.

Se conservaron los dos ZIP originales descargados de GitHub y sus archivos extraídos.
Sus SHA256 coinciden con los digest publicados por la API de artefactos. Los IDs,
URLs, hashes y resultados están en [executions.json](executions.json).

Esta evidencia acredita aceptación del modelo normal y rechazo del degradado en CI.
No acredita por sí sola inferencia en el navegador, métricas de cámara, revisión
independiente del modelo ni otras tareas de PT1. No se modificaron estados de Jira.
