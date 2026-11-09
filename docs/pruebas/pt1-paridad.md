# PT1 · RIKDP-85 · Paridad del preprocesamiento

## Estado de la prueba

**Prueba implementada; criterio de paridad no aprobado.** La medición local
encontró diferencias de resize para imágenes cuadradas 512×512. Conforme al
alcance acordado, esta entrega añade pruebas y documenta el defecto: no modifica
el notebook, `ml/preprocessing.py`, el preprocesamiento web, el modelo ni sus pesos.
No se debe cerrar el caso como aprobado hasta corregir o resolver técnicamente
la discrepancia y repetir la medición.

## Qué se compara

`python -m ml.preprocessing_parity` genera seis PNG cuadrados RGB temporales:
color conocido, gradiente y bordes alternos, en 400×400 y 512×512. Cada imagen
se procesa de forma independiente mediante:

1. `ml.preprocessing.preprocess_image`: PIL y normalización a float32 /255.
2. `ml.preprocessing.make_tf_dataset`, sin augmentation ni shuffle: TensorFlow
   real, el mismo código de entrada utilizado por el notebook al entrenar.
3. Chromium real: `drawModelInput` de la web, canvas y TensorFlow.js 4.22.0 CPU.
   El harness extrae mediante el parser de TypeScript las operaciones que
   `loader.ts` ejecuta antes de `model.predict(batch)`. No escribe una segunda
   implementación del resize o de la normalización ni necesita cargar pesos.

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

La comparación usa CPU de TF.js en Chromium para evitar depender de una GPU.
El contrato de esta medición es 400×400 RGB, escala 1/255 y offset 0. No se
descarga ni se infiere la configuración de un manifest remoto.
No acredita equivalencia de inferencia de WebGL/WASM, métricas del modelo,
decodificación JPEG, cámara, orientación de celular ni imágenes rectangulares.
Esos escenarios no se confunden con la prueba de tensor sobre originales
cuadrados ni con la evaluación de hojas impresas de RIKDP-254.

## Defecto reproducido · RIKDP-85-D01

Pasos: ejecutar la medición con los fixtures incluidos. Los casos 400×400
(sin resize) y el color uniforme 512×512 pasan. El gradiente y los bordes
512×512 fallan tanto contra PIL como contra TensorFlow de entrenamiento.

Las rutas actuales son distintas:

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

**Tratamiento pendiente:** registrar/revisar el defecto con el responsable de
ML y web, confirmar el contrato de entrada de la versión publicada y decidir
qué implementación alinear al entrenamiento. La corrección necesita volver a
evaluar predicciones y métricas. Esta entrega no presupone reentrenamiento ni
autoriza modificar el modelo. `RIKDP-85-D01` es una referencia documental local,
no una incidencia creada automáticamente en Jira.

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
La suite ML completa aprobó 142 pruebas y cuatro subtests; Ruff, formato de los
archivos Python nuevos, sintaxis JavaScript y YAML del workflow también se validaron.
Estos resultados validan las herramientas de prueba; la medición real completó
los seis casos y devolvió salida 1 por los dos casos rechazados.

## Ejecución en GitHub

Se añade **PT1 preprocessing parity**, de ejecución manual, que conserva
`pt1-parity-evidence` durante 14 días incluso cuando falla. La discrepancia
actual provoca salida 1 y job rojo; no hay `continue-on-error` ni exclusiones.
Es manual para realizar el diagnóstico controlado sin añadir un caso conocido
fallido a cada PR del proyecto. No se añade al job obligatorio CI.

El workflow aparecerá en Actions una vez incorporado a la rama por defecto.
La ejecución remota está pendiente. Adjuntar el SHA y la URL del run al caso
de Jira y conservar el artefacto antes de su expiración.
