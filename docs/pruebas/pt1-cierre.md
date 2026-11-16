# PT1 · Testing de ResNet50V2

Revisión del 16/11/2026: el notebook contiene entrenamiento y pruebas ejecutadas de ResNet50V2.
Las referencias de CI están en estado `ready`. La tarea completa conserva dos pendientes:
aceptación por una persona distinta del autor (RIKDP-131) y evaluación con capturas físicas (RIKDP-254).

| Caso | Comprobación vigente |
| --- | --- |
| RIKDP-84 | Entrada RGB float32 [0,1], [1,400,400,3]; comprobación de código y celda Testing. |
| RIKDP-85 | Resize half-pixel Python/TF.js; pruebas de píxeles independientes de los pesos. |
| RIKDP-96 | Validación de datos corruptos, duplicados y fuga entre particiones. |
| RIKDP-101 | El notebook registra dos fits nuevos aprobados. El comparador CLI exige ahora warmup versionado, fine-tuning y validation, tolerancia 1e-6. |
| RIKDP-131 | Gate de 195 imágenes: accuracy y recall 100 %. Falta aceptación independiente; ejecutor automático no sustituye al revisor. |
| RIKDP-145 | Acreditado en GitHub: caso normal verde y degradado rechazado con 25 discrepancias. Ver [evidencia](../evidencias/RIKDP-145/README.md). |
| RIKDP-154 | Gate original de 195 imágenes y comparación adicional de Keras con el cargador real de Chromium sobre 50 imágenes; ver [ensayo](pt1-paridad-navegador.md). |
| RIKDP-166 | Política de límite 94,9/95,0 y bloqueo de publicación, sin relajar umbrales. |
| RIKDP-254 | >=100 capturas físicas de hojas impresas etiquetadas por una persona; caída de métricas documentada. |

## Ejecución

Ejecutar el notebook raíz en Colab con GPU desde instalación y LIBRERIAS. Después de entrenar la CNN baseline y
las cuatro configuraciones ResNet, se selecciona ResNet por validation, se evalúa test y se exporta a TF.js.
La sección **Testing de ResNet50V2** ejecuta dos réplicas adicionales, valida entrada/métricas y compara los
195 tensores con el modelo exportado. No cambiar el umbral usando test para conseguir un aprobado.

Los informes nuevos quedan en `reports/resnet50v2-testing`, `reports/independent-metrics` y `reports/quality_gate`
del proyecto en Drive. No se rellenan porcentajes ni aprobaciones antes de ejecutar el entrenamiento real.
Ver [reproducibilidad](pt1-colab-reproducibilidad.md), [revisión independiente](pt1-revision-independiente.md)
y [capturas](pt1-capturas.md).

## Referencias de CI

La celda **Referencias nuevas para CI** sólo se ejecuta después de aprobar el gate. Construye 50 imágenes
reales del test (25 por clase), punteros nuevos `golden/real.dvc` y `models/regression.dvc`, configuración y catálogo.
La primera baseline es el ResNet aprobado; el candidato inicial contiene los mismos pesos. La CNN es benchmark,
no baseline de producción para comparar arquitecturas distintas mediante el límite de discrepancias.

Subir `ci-reference-resnet.zip` a un Drive accesible para lectura de CI, definir `RIKUY_REGRESSION_BUNDLE_ID`
y repetir únicamente la celda de referencias. El ZIP y los modelos no van a GitHub. Llevar a GitHub los `.dvc`,
`ml/regression-config.json`, `ml/regression-sources.json` y `ml/regression-metadata/*.json` generados.

La configuración y el catálogo actuales llevan estado `ready`; los ensayos de CI conservados
descargaron las referencias y ejecutaron el modelo real. No cambiar los hashes para evitar errores de integridad.

Después de configurar el catálogo nuevo, ejecutar manualmente HU22 model regression con `degraded=true`.
Conservar el run, SHA y artefactos: debe fallar por discrepancias reales y aprobar la verificación posterior
del motivo. Para probar el caso normal, usar `degraded=false`.

## Alcance de la validación local

Las pruebas unitarias verifican contratos y casos negativos con fixtures. El ensayo adicional
`ml/browser_model_parity.py` carga el checkpoint ResNet y su exportación reales, verifica sus hashes
y ejecuta el cargador web en Chromium. Usa los mismos píxeles RGB decodificados y transportados como PNG:
no acredita equivalencia entre decodificadores JPEG, rendimiento en un móvil ni capturas de hojas impresas.
No se han modificado estados de Jira ni registrado una aceptación humana.
