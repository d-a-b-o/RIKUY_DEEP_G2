# PT1 · RIKDP-85 · Paridad del preprocesamiento

## Estado de la prueba

**Corrección aprobada localmente el 09/11/2026:** los 16 casos pasan contra
Python y TensorFlow de entrenamiento, sin cambiar la tolerancia de 1e-6.
La primera entrega documentó el defecto; posteriormente el usuario autorizó
proceder con los pendientes y se corrigió la inferencia Python/web para
reproducir el resize del entrenamiento. No se entrenó ni cambió el modelo.
El reporte corregido se conserva en
[RIKDP-85-paridad-corregida.json](../evidencias/RIKDP-85-paridad-corregida.json).

## Qué se compara

`python -m ml.preprocessing_parity` genera 16 PNG cuadrados RGB temporales:
color conocido, gradiente, bordes alternos y ruido reproducible, en 128×128,
400×400, 512×512 y 517×517. Se comprueban ampliación, reducción y tamaño idéntico. Cada imagen
se procesa de forma independiente mediante:

1. `ml.preprocessing.preprocess_image`: decodificación PIL, interpolación NumPy
   bilinear half-pixel en float32 sin antialias ni cuantización intermedia, /255.
2. `ml.preprocessing.make_tf_dataset`, sin augmentation ni shuffle: TensorFlow
   real, el mismo código de entrada utilizado por el notebook al entrenar.
3. Chromium real: `drawModelInput` de la web, canvas y TensorFlow.js 4.22.0 CPU.
   El harness extrae mediante el parser de TypeScript las operaciones que
   `loader.ts` ejecuta antes de `model.predict(batch)`. No escribe una segunda
   implementación del resize o de la normalización ni necesita cargar pesos.

La web conserva el recorte nativo en canvas y `resizeModelPixels` interpola
con operaciones TensorFlow.js float32. No usa canvas para redimensionar:
cuantizarlo a uint8 elimina información. Tampoco basta activar half-pixel en
`tf.image.resizeBilinear`: el kernel CPU TF.js 4.22 usa coordenadas double y
en los bordes supera 1e-6 frente al cálculo float32 de TensorFlow. La corrección
calcula coordenadas, pesos y mezclas en float32 y libera los intermedios en
`tf.tidy`. Conserva el recorte centrado existente para fotogramas rectangulares.

El contrato PIL v1 de la regresión HU22 se conserva explícitamente en
`preprocess_regression_image`; `ml.regression` lo usa con el identificador
histórico inmutable. Los dos checkpoints siguen recibiendo sus mismos tensores
PIL. No se cambia su baseline ni se reinterpreta como paridad de entrenamiento.

La extracción reemplaza únicamente la llamada al modelo por la devolución del
tensor de entrada. Si cambia la estructura del loader y no puede extraerse,
la medición queda incompleta; no se considera aprobada. TypeScript y TF.js
proceden de las dependencias fijadas en el lockfile de `apps/web`.

Se exige forma `[1,400,400,3]`, dtype float32, datos finitos en [0,1] y error
absoluto **por canal <=1e-6**, con tolerancia relativa cero. Ese margen permite
el redondeo de float32 en la normalización; no permite diferencias de un nivel
de color (1/255). No se usa el error medio para ocultar píxeles discrepantes.
Este criterio de tensores es diferente de la tolerancia 1e-4 de probabilidades
del quality gate. No debe ajustarse solo para hacer pasar las pruebas.

La comparación usa CPU de TF.js en Chromium por defecto. También se ejecutaron
los mismos casos con WASM y con WebGL vía ANGLE/SwiftShader, sin GPU física.
El contrato de esta medición es 400×400 RGB, escala 1/255 y offset 0. No se
descarga ni se infiere la configuración de un manifest remoto.
La comparación de tensores no acredita equivalencia de inferencia del modelo,
decodificación JPEG, cámara, orientación de celular ni imágenes rectangulares.
Esos escenarios no se confunden con la prueba de tensor sobre originales
cuadrados ni con la evaluación de hojas impresas de RIKDP-254.

## Diagnóstico original · RIKDP-85-D01

Antes de la corrección, los casos 400×400 (sin resize) y el color uniforme
512×512 pasaban. El gradiente y los bordes 512×512 fallaban tanto contra PIL
como contra TensorFlow de entrenamiento. Se conserva el reporte histórico.

Las rutas del diagnóstico original eran distintas:

- PIL: `Image.resize(..., BILINEAR)`.
- Entrenamiento: `tf.image.resize(..., method="bilinear")`.
- Navegador: canvas con `imageSmoothingQuality="high"`.

La palabra «bilinear» o el ajuste «high» no garantiza los mismos píxeles entre
esas implementaciones. El fallo aparece con imágenes cuadradas y no depende
del recorte de un fotograma rectangular.

El reporte de referencia está en `docs/evidencias/RIKDP-85-paridad.json`:
contiene versiones, hashes de fuentes e imágenes, diferencias máximas y medias,
y número de canales que superan la tolerancia. No contiene pesos, credenciales
ni datos reales. Los patrones sintéticos revelan el defecto; sus errores no
permiten deducir directamente una caída de accuracy en fotos de piezas reales.

Medición local del 03/11/2026: Python 3.13.1, TensorFlow 2.20.0,
TensorFlow.js 4.22.0, Playwright 1.58.0 y Chromium 145.0.7632.6 (Windows).

| Imagen cuadrada | Máximo PIL ↔ navegador | Máximo TensorFlow ↔ navegador | Resultado |
| --- | --- | --- | --- |
| Tres patrones 400×400 | <=5.97e-8 | <=5.97e-8 | Cumplen la tolerancia. |
| Color uniforme 512×512 | 1.49e-8 | 1.49e-8 | Cumple la tolerancia. |
| Gradiente 512×512 | 0.00392157 | 0.00391373 | No cumple. |
| Bordes 512×512 | 0.30980393 | 0.11279570 | No cumple. |

**Tratamiento aplicado el 09/11/2026:** inferencia alineada a
`make_tf_dataset`, que ya utilizaba half-pixel sin antialias al entrenar.
Se mantiene el reporte original como diagnóstico y se añade uno nuevo aprobado.
Las métricas de imágenes de cámara se medirán con las capturas reales de
RIKDP-254; aprobar los tensores sintéticos no acredita esas métricas.
`RIKDP-85-D01` es una referencia documental local, no una incidencia creada en Jira.

## Ejecutar en local

En el entorno virtual del modelo, desde la raíz:

```sh
python -m pip install -r ml/requirements-regression.txt
npm ci --prefix apps/web --ignore-scripts --no-audit --no-fund
python -m playwright install chromium
python -m pytest -c ml/pytest.ini ml/tests/test_preprocessing_parity.py -q
python -m ml.preprocessing_parity --output reports/preprocessing-parity
```

Requiere Node.js 22+, Chromium de Playwright y TensorFlow CPU. No requiere
levantar Next.js, PostgreSQL, montar Drive, descargar modelos ni entrenar.
En Linux pueden necesitarse las bibliotecas de sistema que instala
`python -m playwright install --with-deps chromium`.

| Salida de la medición | Significado |
| --- | --- |
| 0 | Comparación completa y todos los tensores cumplen el criterio. |
| 1 | Comparación completa, pero hay discrepancias: caso de paridad rechazado. |
| 2 | Medición incompleta: faltan herramientas, backend, fuentes o falló la ejecución. |

Los diez tests unitarios validan la política, formatos, fixtures y códigos de
salida; que pasen no significa que exista paridad real. `RIKDP-85.json` es el
resultado de la comparación real. `reports/` está excluido de Git.
La suite ML corregida aprobó 164 pruebas y cuatro subtests antes de añadir las
herramientas de evaluación de RIKDP-131/254. Incluye comparación
de NumPy con TensorFlow real sobre píxeles aleatorios, tamaños 1/128/400/512/517
y conservación exacta del resize PIL histórico. La medición real de Chromium
completó los 16 casos y devolvió salida 0. Los seis tests web del preprocesamiento
comprueban recorte, interpolación y ausencia de crecimiento de tensores.
TypeScript y ESLint de los archivos web modificados también aprobaron.

Para repetir los backends adicionales:

```sh
python -m ml.preprocessing_parity --backend webgl --output reports/parity-webgl
python -m ml.preprocessing_parity --backend wasm --output reports/parity-wasm
```

Los tres informes completaron 16 casos y salida 0, con máximo error frente a
TensorFlow de 5.960464477539063e-08. Se conservan los resultados de
[WebGL/SwiftShader](../evidencias/RIKDP-85-paridad-webgl.json) y
[WASM](../evidencias/RIKDP-85-paridad-wasm.json), además del informe CPU.

En el notebook sólo se cambió la consulta de ruta de una celda de diagnóstico
(`r.__spec__.origin`); no se modificó el pipeline de entrenamiento.

## Ejecución en GitHub

Se añade **PT1 preprocessing parity**, de ejecución manual, que conserva
`pt1-parity-evidence` durante 14 días incluso cuando falla. La versión corregida
debe devolver salida 0; cualquier discrepancia o ejecución incompleta sigue
haciendo fallar el job, sin `continue-on-error` ni exclusiones.
Se conserva la ejecución manual; no se añade al job obligatorio CI.

El workflow aparecerá en Actions una vez incorporado a la rama por defecto.
La ejecución remota está pendiente. Adjuntar el SHA y la URL del run al caso
de Jira y conservar el artefacto antes de su expiración.
