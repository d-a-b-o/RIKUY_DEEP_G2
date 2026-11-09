# PT1 · RIKDP-84 · Forma y rango del preprocesamiento

## Objetivo y alcance

Comprobar la entrada del modelo existente: imágenes cuadradas convertidas a RGB,
400×400×3, `float32`, valores finitos en [0,1]. El reescalado a [-1,1] pertenece
al interior del modelo y no debe aplicarse otra vez en estas funciones.

Las pruebas usan imágenes sintéticas pequeñas generadas en carpetas temporales.
No descargan el dataset, cargan un checkpoint, entrenan, cambian pesos ni modifican
el preprocesamiento. La comparación de píxeles Python/navegador es RIKDP-85 y
las capturas de hojas impresas con webcam/celular corresponden a RIKDP-254.

## Cobertura

| Camino | Comprobaciones |
| --- | --- |
| `preprocess_image` (PIL) | Contrato fijo 400×400, dtype, finitud, rango y orden RGB; imágenes cuadradas 128×128, 400×400 y 512×512; rutas, ndarray y escala de grises ya cubiertos. |
| `make_tf_dataset` (TensorFlow real) | Resize de las mismas dimensiones cuadradas, normalización de colores conocidos, decodificación RGB de PNG gris/RGBA, forma de lotes completos y parciales, etiquetas int32 y orden sin shuffle en evaluación. |
| Evaluación sin augmentation | Negro→0, blanco→1 y recorridos repetidos con los mismos tensores y etiquetas. |
| Entrada de entrenamiento con augmentation | Forma, dtype, finitud y rango después de las transformaciones; no ejecuta `model.fit`. |

## Ejecutar

Con el entorno ligero de ML:

```sh
python -m pytest -c ml/pytest.ini ml/tests/test_preprocessing.py -q
```

Para comprobar también TensorFlow, instalar en un entorno virtual las dependencias
de `ml/requirements-regression.txt`, que ya incluye pytest, y ejecutar:

```sh
python -m pip install -r ml/requirements-regression.txt
PT1_REQUIRE_TENSORFLOW=1 python -m pytest -c ml/pytest.ini ml/tests/test_preprocessing.py ml/tests/test_preprocessing_tensorflow.py --junitxml=reports/preprocessing/RIKDP-84.xml
```

En PowerShell definir primero `$env:PT1_REQUIRE_TENSORFLOW = '1'` y ejecutar
el mismo comando empezando por `python`.

Sin TensorFlow, la suite ligera omite explícitamente los siete casos del archivo
`test_preprocessing_tensorflow.py`. Con `PT1_REQUIRE_TENSORFLOW=1`, una instalación
ausente o rota es un error: no se admite convertirla en una omisión aprobada.

## Ejecución automatizada y evidencia

Validación local del 03/11/2026, Python 3.13 y TensorFlow CPU 2.20.0:

- 19 pruebas de preprocesamiento aprobadas, incluidas siete con TensorFlow real;
  cero omisiones, errores o fallos en `reports/preprocessing/RIKDP-84-local.xml`.
- Suite completa ML: 132 pruebas y cuatro subtests aprobados.
- Ruff y formato de los dos archivos de pruebas aprobados; YAML del workflow validado.
- TensorFlow/gast emite advertencias de deprecación en Python 3.13; no causaron
  fallos. El job real utiliza Python 3.11 conforme a su configuración existente.

El workflow `HU22 model regression`, job `HU22 real model gate`, instala el
entorno TensorFlow CPU existente y ejecuta ambos archivos **antes** de descargar
los modelos y las imágenes reales. Guarda el JUnit como artefacto
`pt1-preprocessing-evidence`, durante 14 días, incluso si el paso falla.
Se mantiene el alcance actual del workflow: PR y ejecución manual.

Este workflow es independiente del check obligatorio CI. Un fallo de estos tests
hace fallar el job de modelo, pero por sí solo no cambia las dependencias del job
puerta CI. No se modifica esa política en esta subtarea de pruebas.

Para cerrar RIKDP-84, conservar el SHA y la URL de ejecución, descargar el JUnit y
registrar el resultado en Jira. Una prueba local aprobada no acredita todavía la
ejecución remota. Los resultados no demuestran la paridad TF.js ni las métricas
del modelo, que se evalúan en otras subtareas de PT1.

## Cierre técnico verificado el 08/11/2026

El [run 41703755247](https://github.com/d-a-b-o/RIKUY_DEEP_G2/actions/runs/41703755247/job/126153538948)
del commit `d168901d63b20a3158e434d897027a160c34d1e7` terminó aprobado.
El log del paso de TensorFlow acredita **19 passed in 2.53s**, con TensorFlow
obligatorio. El artefacto `pt1-preprocessing-evidence` se conserva hasta el
17/11/2026; su identificador y digest están en
[`RIKDP-84-ci.json`](../evidencias/RIKDP-84-ci.json).
Esto resuelve la evidencia remota pendiente descrita arriba. No se cambió el
estado de Jira. Descargar el JUnit antes de que expire el artefacto si se necesita
conservar el XML original fuera de Actions.

El XML ya fue descargado y conservado en
[`RIKDP-84-ci.xml`](../evidencias/RIKDP-84-ci.xml), verificando primero el digest
del ZIP contra GitHub. No depende de la retención futura del artefacto.
