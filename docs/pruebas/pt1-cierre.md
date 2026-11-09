# PT1 · Evidencia de modelo y estado de cierre

Revisión y ejecuciones locales del 08/11/2026 en la rama
`RIKDP-250-pt1-pruebas-del-modelo-de-ia`. No se publica ni sustituye el modelo,
no se modifica el notebook y no se cambian estados de Jira.

Actualización del 09/11/2026: evidencia de RIKDP-101 recibida, RIKDP-96 aprobada
y corrección de RIKDP-85 validada. El único cambio adicional del notebook es
una consulta de ruta en la celda de diagnóstico, sin alterar el entrenamiento.

## Resultados y límites

| Caso | Evidencia y estado técnico |
| --- | --- |
| RIKDP-84 | Aprobado: 19 pruebas reales en GitHub Actions. Se conserva el JUnit original y la referencia al run. |
| RIKDP-85 | Corrección aprobada localmente: 16 patrones cuadrados en CPU, WebGL/SwiftShader y WASM, todos dentro de 1e-6 contra Python y TensorFlow real. Falta subir el cambio y conservar la ejecución remota. |
| RIKDP-96 | Aprobado localmente el 09/11/2026: tres pruebas existentes de corrupción, duplicados recodificados y etiquetas contradictorias. JUnit conservado. |
| RIKDP-166 | Aprobado localmente: 94,9 % rechaza y 95,0 % acepta; publicación bloqueada bajo el umbral. Se añadieron pruebas permanentes. |
| RIKDP-154 | Aprobado para Keras ↔ TF.js CPU con tensores idénticos: nueva inferencia sobre 50 imágenes reales, cero discrepancias, diferencia máxima 2.9206275939941406e-06. |
| RIKDP-131 | Métricas originales verificadas mediante un cálculo independiente: accuracy 98,4615 %, recall 100 %. Falta la firma de una persona distinta del autor para cerrar el requisito de revisión humana. |
| RIKDP-145 | Rechazo real acreditado localmente: una copia degradada del checkpoint produce 25 discrepancias y salida 1. Falta ejecutar y enlazar el job rojo en GitHub después de subir estos cambios. |
| RIKDP-101 | Aprobado según la salida de Colab aportada el 09/11/2026: dos fits de nueve épocas, semilla 42, historiales y métricas iguales, diferencias vacías con tolerancia 1e-6. Reporte conservado. |
| RIKDP-254 | Evaluador e inventario implementados y probados; faltan >=100 capturas físicas etiquetadas, su medición y revisión del origen. |

Estos resultados no cierran por sí solos RIKDP-250: faltan el rechazo remoto del
modelo degradado, la revisión humana independiente de métricas y las >=100
capturas de hojas impresas con webcam/celular y su evaluación.

## Corrección de inferencia · RIKDP-85

La referencia es `make_tf_dataset`, que se utilizó al entrenar. La inferencia
Python y la web ahora interpolan con coordenadas half-pixel float32, sin
antialias ni redondeo intermedio a uint8. La matriz de 16 PNG incluye colores,
gradientes, bordes y ruido a 128/400/512/517 píxeles. Los tres backends pasaron;
error máximo contra TensorFlow 5.960464477539063e-08.

WebGL se comprobó en Chromium con ANGLE/SwiftShader; no sustituye una medición
de hardware físico ni la evaluación de las fotos JPEG de RIKDP-254.
El [procedimiento](pt1-paridad.md) conserva los límites y el diagnóstico original.
La regresión HU22 usa ahora una función explícita del resize PIL v1: las
probabilidades reales de sus 50 imágenes son idénticas a las de antes de la
corrección, conservando sus dos discrepancias. Ver
[compatibilidad](../evidencias/RIKDP-85-regresion-compatible.json).

Los informes anteriores de RIKDP-101/131/154 pertenecen a sus versiones y
artefactos originales; no se reescriben para atribuirles el código nuevo.
No es necesario repetir los dos entrenamientos de RIKDP-101.

## Datos corruptos y duplicados · RIKDP-96

El 09/11/2026 se ejecutaron tres pruebas existentes de `ml/tests/test_workflow.py`:
`test_prepare_reuses_file_and_excludes_duplicates`, `test_corrupt_images_rejected`
y `test_conflicting_labels_rejected`. Resultado: **3 passed**; evidencia en
[RIKDP-96-datos.xml](../evidencias/RIKDP-96-datos.xml).

El duplicado recodificado como BMP se excluye y las imágenes únicas conservan
un solo hash de píxeles. Una imagen corrupta y la misma imagen con etiquetas
contradictorias detienen la preparación. Son muestras sintéticas temporales:
no se modifica el dataset real, no se crea otro split ni se entrena.

```sh
python -m pytest -c ml/pytest.ini ml/tests/test_workflow.py::WorkflowTests::test_prepare_reuses_file_and_excludes_duplicates ml/tests/test_workflow.py::WorkflowTests::test_corrupt_images_rejected ml/tests/test_workflow.py::WorkflowTests::test_conflicting_labels_rejected --junitxml=reports/RIKDP-96-datos.xml -q
```

## Forma y rango · RIKDP-84

[Run y job reales](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/41703755247/job/126153538948),
commit `d168901d63b20a3158e434d897027a160c34d1e7`, paso de TensorFlow aprobado:
`19 passed in 2.53s`. La comprobación obliga a importar TensorFlow real.

Se descargó el artefacto y verificó su SHA256 contra el digest de GitHub.
El XML original se conserva en [RIKDP-84-ci.xml](../evidencias/RIKDP-84-ci.xml);
los identificadores y digest están en [RIKDP-84-ci.json](../evidencias/RIKDP-84-ci.json).
Este respaldo persiste aunque expire el artefacto de Actions.

## Límite del quality gate · RIKDP-166

`test_exact_recall_boundary` usa 2000 predicciones sintéticas: 1000 positivas y
1000 negativas. Con 949 verdaderos positivos, recall=0,949 y accuracy=0,9745:
falla exclusivamente recall. Con 950, recall=0,95 y accuracy=0,975: aprueba.
Los motores coinciden y la diferencia numérica es cero en ambos casos.

Se usa `expected_count=2000` únicamente en el ensayo de la política para representar
exactamente 94,9 %. El publicador conserva su contrato de 195 muestras; no se
relaja su tamaño ni el umbral. La prueba adicional del publicador usa 195 muestras,
100 positivas: 95/100 permite el plan de publicación y 94/100 bloquea antes de
abrir el cliente remoto. No se hace ninguna escritura real en R2.

```sh
python -m pytest -c ml/pytest.ini ml/tests/test_quality_gate.py ml/tests/test_publication.py --junitxml=reports/RIKDP-166.xml
```

Se conservan [las decisiones calculadas](../evidencias/RIKDP-166-limite.json)
y [los cuatro casos de frontera en JUnit](../evidencias/RIKDP-166-tests.xml).

## Paridad real y métricas · RIKDP-154 y RIKDP-131

Se recuperaron los archivos de la
[corrida seleccionada](https://drive.google.com/drive/folders/1KJIv_xMi5CPbZjzs357DmtWlZnUoyFrp),
la [exportación](https://drive.google.com/drive/folders/1zW5VE0othQ0IATyak6QFTCUWUW8fZn9K)
y el [reporte original de 195 imágenes](https://drive.google.com/file/d/196KHDmdY8xD9rPMZLvmllWmz2U4-NU1W/view).
El checkpoint tiene SHA256
`28f54a232e3dbdf2498cba8a5d8aa2002d9a312c560ce3acd818023b77ba949e`;
el umbral, elegido en validation, es `0.24371959269046783`.

`ml.pt1_validation` verifica los hashes de los artefactos de la corrida, las
195 filas de test originales, su pertenencia al manifiesto de entrenamiento,
la identidad de exportación, los pesos Keras/TF.js y la decisión del gate.
Recalcula métricas con scikit-learn desde las predicciones completas, sin usar
los porcentajes resumidos como fuente de verdad.

| Métrica sobre el test reservado | Resultado |
| --- | --- |
| Accuracy | 192/195 = 98,4615 % |
| Recall de defectos | 117/117 = 100 % |
| Precision de defectos | 117/120 = 97,5 % |
| Matriz de confusión: filas real OK/defecto, columnas predicho OK/defecto | [[75, 3], [0, 117]] |
| Discrepancias originales Keras/TF.js | 0/195 |
| Máxima diferencia de probabilidad original | 3.0994415283203125e-06 |

La auditoría de 195 muestras **revalida inferencias anteriores**; no afirma
haberlas repetido localmente. Accuracy, recall, precision, F1, AP, ROC AUC y la
matriz coinciden con `test.json`. Brier difiere 3.64e-08 entre los reportes;
se admite un margen absoluto explícito de 1e-6 para esa métrica continua entre
la evaluación por lotes y la inferencia individual. No cambia los veredictos.

Además, `ml.pt1_inference` realizó una **nueva inferencia real** sobre las 50
imágenes versionadas de `golden/real`, usando el mismo tensor TensorFlow en ambos
motores y los pesos de la exportación original, sin conversión nueva. Resultado:
0 discrepancias y error máximo 2.92e-06, inferior a 1e-4. Runtime: TensorFlow CPU
2.20.0, TF.js CPU 4.22.0 y Node.js 26.3.0. No hay motores simulados en esa medición.

Las 50 imágenes son un subconjunto para paridad, no sustituyen el test de 195.
Su accuracy observada fue 94 % y recall 100 % en ambos motores. El campo
`measurement.passed` del reporte conserva el rechazo de la política conjunta
por accuracy; `passed` exterior evalúa exclusivamente el criterio de paridad.
No se usa esa muestra para afirmar que cumple las métricas del test completo.
La paridad de estos motores no acredita canvas, cámara, WebGL ni WASM.

Evidencias versionadas:

- [Reporte original completo](../evidencias/RIKDP-154-quality-gate-original.json).
- [Verificación de integridad y métricas](../evidencias/RIKDP-131-metricas.json).
- [Nueva inferencia real de 50 imágenes](../evidencias/RIKDP-154-paridad-real.json).

Para repetir, recuperar la corrida completa en `RUN` y la exportación en `EXPORT`:

```sh
python -m ml.pt1_validation --source-report SOURCE_REPORT --run RUN --export EXPORT --output reports/pt1-validation.json
python -m ml.pt1_inference --source-report SOURCE_REPORT --run RUN --export EXPORT --output reports/pt1-inference.json
```

La segunda orden requiere las 50 imágenes/modelos recuperados por
`python -m ml.regression_data` y las dependencias web instaladas. En la revisión
se usó una copia equivalente bajo `reports/pt1-real` con `--config` apuntando a
su JSON. Pesos, imágenes y tensores temporales quedan fuera de Git.
Para cerrar RIKDP-131, otra persona del equipo debe revisar el cálculo y dejar
su nombre, fecha y aceptación; el campo `human_independent_reviewer` se deja nulo.

## Modelo degradado · RIKDP-145

`ml.regression_negative` verifica hashes y carga el checkpoint real. Guarda
una copia con kernel final cero y bias -12; así la salida sigmoid queda
prácticamente constante y pierde detecciones. Los archivos originales no cambian.
Ejecuta el mismo comando de regresión que usa CI, en un proceso independiente.

```sh
python -m ml.regression_negative
```

La orden devuelve 0 **si el control negativo demostró el rechazo**. El proceso
de regresión interno devolvió 1 por 25 discrepancias en 50 imágenes reales.
Un error de descarga/configuración (salida 2), reporte ausente o diferencias
insuficientes no cuenta como rechazo válido. Evidencia:
[RIKDP-145-modelo-degradado-local.json](../evidencias/RIKDP-145-modelo-degradado-local.json).

Para acreditar específicamente CI después del push, ejecutar manualmente
**HU22 model regression** en esta rama con `degraded=true`.
El paso de comparación devuelve 1 sin `continue-on-error`: el job debe quedar
rojo. El paso posterior comprueba que el fallo corresponde a predicciones reales,
y el artefacto `hu22-real-regression-evidence` guarda reporte, hashes y código
de salida durante 14 días. Registrar URL/SHA y conservar esos archivos antes
de expirar. `degraded=false` conserva la comparación normal. No se ejecutó el
workflow modificado remotamente durante esta entrega, porque aún es un cambio local.

El 09/11/2026 se verificó que la rama remota ya contiene `degraded` en
`model-regression.yml`. No se encontró un PR de esa rama ni se acreditó un run
rojo nuevo. Para ejecutar deliberadamente el control con GitHub CLI:

```sh
gh workflow run model-regression.yml --repo d-a-b-o/RIKUY_DEEP_G2 --ref RIKDP-96-pt1-componente-validacion-de-datos-con-imagene -f degraded=true
```

Debe fallar el paso real con salida 1 y deben aprobar las comprobaciones
posteriores de origen del fallo. Conservar URL, SHA, `regression.json`,
`provenance.json`, `gate-exit-code.txt` y `verification.json`. Un job rojo por
descarga o configuración no demuestra que el modelo degradado fue rechazado.

## Pendientes con participación del equipo

- RIKDP-131: [inferencia nueva del test reservado y acta de revisión](pt1-revision-independiente.md).
  `ml.independent_metrics` evalúa las 195 imágenes sin usar la caché ni entrenar;
  la aceptación debe proceder de otra persona, no de un campo rellenado por el script.
- RIKDP-254: [protocolo de capturas y evaluación](pt1-capturas.md).
  `ml.capture_evaluation` exige >=100 imágenes únicas, etiqueta humana y ambas
  clases; mide la caída respecto al modelo original sin ajustar el umbral.
  Su herramienta tiene tests sintéticos de contrato, aún no evidencia física.

## Reproducibilidad · RIKDP-101

Las cuatro corridas MobileNetV2 encontradas comparten semilla 42, pero cambian
learning rate, dropout y fracción descongelada. No prueban reproducibilidad;
[RIKDP-101-estado.json](../evidencias/RIKDP-101-estado.json) conserva los parámetros.
La reutilización de una caché tampoco demuestra dos fits independientes.

`ml.reproducibility` comprueba integridad e identidad de dos corridas, igualdad
de parámetros (salvo etiqueta y ruta), manifiesto, código y versiones. Compara
historial completo por época, métricas de validation y umbral, con tolerancia
absoluta 1e-6 y sin aceptar NaN/inf. Rechaza una carpeta reutilizada o dos copias
de la misma identidad. No compara bytes del ZIP Keras como criterio de métricas.

En Colab/GPU, con el dataset original montado y estos cambios disponibles:

El usuario confirmó que puede ejecutarlo en Colab. La
[celda lista para ejecutar](pt1-colab-reproducibilidad.md) usa la ubicación
observada del repositorio y la corrida seleccionada en Drive.

```sh
python -m ml.reproducibility --train-twice --root REPO_ROOT --reference SELECTED_RUN --output reports/reproducibility/RIKDP-101.json
```

Ejecuta dos entrenamientos independientes con los parámetros de `started.json`
de la referencia; no reduce épocas ni cambia el dataset. Usa etiquetas
`pt1-repro-1/2`, conserva los modelos bajo `models/experiments/` y no activa ni
sustituye el modelo publicado. Rechaza reutilizar etiquetas ya existentes como
si se hubiera entrenado de nuevo. Para comparar dos réplicas ya completadas:

```sh
python -m ml.reproducibility --left RUN_A --right RUN_B
```

Salidas de los comandos de evidencia: 0 aprobado, 1 criterio rechazado,
2 ejecución/evidencia incompleta.

### Resultado recibido el 09/11/2026

El usuario ejecutó las dos réplicas en Colab después de restaurar y verificar
la corrida de referencia y el manifiesto original de 1300 imágenes. La salida
aportada incluye nueve épocas por réplica y el JSON del comparador:
[RIKDP-101-reproducibilidad.json](../evidencias/RIKDP-101-reproducibilidad.json).
`passed=true`, `differences=[]`, semilla 42 y tolerancia absoluta 1e-6.

Las identidades comienzan en `62dcbd133928` y `4aaf55ab4165`; sus historiales y
archivos de métricas tienen hashes iguales. Ambas réplicas obtienen accuracy y
recall de validation 1.0, matriz [[78, 0], [0, 117]] y umbral
0.3573272228240967. Estos resultados son de **validation** y no reemplazan las
métricas del test reservado ni autorizan publicar otro modelo o umbral.

Versiones declaradas: TensorFlow 2.21.0, NumPy 2.4.6, scikit-learn 1.6.1 y
Pillow 11.3.0. Las fuentes locales coinciden con los hashes declarados al
normalizar CRLF de Windows a LF de Colab. El estado y procedencia de la
salida están en [RIKDP-101-estado.json](../evidencias/RIKDP-101-estado.json).
No se recuperaron independientemente los bytes de ambas corridas desde Drive
en esta revisión; la evidencia conservada proviene de la salida aportada por
el usuario. Conservar los artefactos de ambas corridas en Drive y no repetir
`--train-twice`: para volver a comprobarlas se usa `--left`/`--right`.

## Validación del cambio

Actualización del 09/11/2026: **180 pruebas ML y cuatro subtests aprobados**,
seis tests web de preprocesamiento, TypeScript y ESLint aprobados. Comparación
real: 16 casos en cada backend CPU/WebGL-SwiftShader/WASM, todos aprobados.
La comparación de AST confirma que `make_tf_dataset` no cambió respecto al
commit `9764d5a`; las correcciones se aplican a la inferencia. Las herramientas
de RIKDP-131/254 tienen pruebas de contrato, pero su existencia no acredita una
revisión humana ni una evaluación de capturas físicas todavía no aportadas.

Suite ML: **158 pruebas y cuatro subtests aprobados**, con TensorFlow obligatorio
en las pruebas de entrada. Ruff y sintaxis del runner JavaScript aprobados.
Las nuevas pruebas cubren las fronteras, publicación, alteración de hashes y
métricas, semillas distintas, caché/copia de corrida y rechazo por inferencia
frente a fallo de configuración. Los resultados de paridad y control negativo
descritos arriba provienen de ejecuciones reales separadas de esa suite.
