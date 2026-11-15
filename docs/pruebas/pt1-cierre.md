# PT1 · Testing de ResNet50V2

Estado: código de pruebas adaptado; métricas y evidencias del modelo nuevo pendientes de ejecución en Colab.
Se retiraron los checkpoints, catálogos e informes de la arquitectura anterior. No se trasladan sus resultados al nuevo modelo.

| Caso | Comprobación vigente |
| --- | --- |
| RIKDP-84 | Entrada RGB float32 [0,1], [1,400,400,3]; comprobación de código y celda Testing. |
| RIKDP-85 | Resize half-pixel Python/TF.js; pruebas de píxeles independientes de los pesos. |
| RIKDP-96 | Validación de datos corruptos, duplicados y fuga entre particiones. |
| RIKDP-101 | Dos fits ResNet nuevos con misma semilla/parámetros; comparar warmup, fine-tuning y validation, tolerancia 1e-6. |
| RIKDP-131 | Test reservado de 195 imágenes: recall >=95 %, accuracy >=97 %; revisión por otra persona. |
| RIKDP-145 | Copia degradada del ResNet aprobado debe devolver salida 1 y dejar el job real rojo. |
| RIKDP-154 | Keras/TF.js sobre el test reservado: <=2 discrepancias y diferencia de probabilidad <=1e-4. |
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

Mientras no existan artefactos nuevos, la configuración lleva estado `pending_resnet50v2_training`:
el job real falla explícitamente y no descarga referencias retiradas. No es un defecto que deba ocultarse
con continue-on-error ni prueba de rechazo del modelo degradado.

Después de configurar el catálogo nuevo, ejecutar manualmente HU22 model regression con `degraded=true`.
Conservar el run, SHA y artefactos: debe fallar por discrepancias reales y aprobar la verificación posterior
del motivo. Para probar el caso normal, usar `degraded=false`.

## Alcance de la validación local

Los tests locales usan fixtures controlados para verificar contrato, independencia de datos, warmup/fine-tuning,
rechazo de otra arquitectura y generación/lectura del nuevo bundle CI. No demuestran las métricas del ResNet
entrenado, su rendimiento físico en el navegador ni la revisión humana o capturas pendientes.
