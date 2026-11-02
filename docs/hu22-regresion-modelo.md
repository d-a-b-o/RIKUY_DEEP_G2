# HU22 — RIKDP-33: regresión del modelo en CI

Subtareas: RIKDP-143 (conjunto dorado), RIKDP-144 (CI), RIKDP-273 (comparación).

## Alcance y estado

El repositorio contiene punteros DVC a datos/modelos pero no sus contenidos. El remoto
actual es una carpeta de Google Drive montada en Colab, inaccesible para un runner
de GitHub. No hay evidencia nueva de inferencia real. Las 50 imágenes reales y su
validación quedan pendientes. No se han inventado etiquetas ni resultados reales.

`golden/synthetic.dvc` versiona 50 imágenes RGB generadas de 32×32, con etiquetas
alternantes exclusivamente para pruebas. No representan piezas de fundición ni
ground truth. Se reconstruyen con `ml.golden`; no requieren secretos ni un remoto.
El gate real rechaza explícitamente `kind: synthetic`.

## Arquitectura

- `ml/golden.py`: selección determinista de 25 imágenes por clase del split test
  existente, ordenadas por ruta; copia los bytes y etiquetas originales. Nunca crea
  un split nuevo. La selección real exige revisar autorización y procedencia antes de usarla.
- `manifest.json`: IDs únicos, etiqueta 0/1, origen y SHA256 por imagen, hash del
  manifiesto fuente, clases y tipo de conjunto. El validador decodifica las imágenes,
  comprueba hashes, rutas, cobertura, ambas clases y tamaño exacto de 50.
- `ml/regression.py`: carga ambos checkpoints Keras, usa el mismo
  `ml.preprocessing.preprocess_image` y aplica `probability >= threshold`.
  RGB bilinear 400×400 float32 /255; no augmentation ni segunda normalización.
  Los contratos deben declarar `ok_front=0`, `def_front=1`, el mismo preprocesamiento
  y el mismo umbral. El ejemplo usa 0.2649; confirmar el valor exacto con el
  `preprocessing.json` de los checkpoints, sin redondearlo.
- Reportes ordenados por ID, sin timestamps variables, con hashes del manifiesto,
  configuración y checkpoints. Esto compara versiones Keras; no sustituye el gate
  de paridad Python/TF.js de HU25 ni evalúa métricas de calidad absolutas.

## Ejecutar desde la raíz

```powershell
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install -r ml/requirements-ci.txt
.venv/Scripts/python -m pytest -c ml/pytest.ini ml/tests
cd ml
../.venv/Scripts/ruff check .
../.venv/Scripts/ruff format --check .
cd ..
.venv/Scripts/python -m ml.golden --output golden/synthetic
.venv/Scripts/dvc add golden/synthetic
git diff --exit-code -- golden/synthetic.dvc
.venv/Scripts/dvc checkout golden/synthetic.dvc
```

El generador exige un destino inexistente para no sobrescribir datos. En una máquina
con cache DVC también se puede ejecutar directamente `dvc checkout`. Sin cache ni
remoto, reconstruir los fixtures con el comando anterior y verificar el puntero.
En Linux, usar `python`, `ruff` y `dvc` del entorno activado.

## Habilitar imágenes y modelos reales

1. En el entorno autorizado de Colab, recuperar `data.dvc` y los checkpoints existentes.
2. Revisar las etiquetas originales y la autorización de las imágenes. Ejecutar:

   ```bash
   python -m ml.golden --source-manifest data/prepared/manifest.json --root . --output golden/real
   dvc add golden/real
   # Colocar checkpoints aprobados como baseline.keras y candidate.keras:
   dvc add models/regression
   ```

3. Copiar `ml/regression-config.example.json` a `ml/regression-config.json`.
   Completar SHA256 y contratos desde los artefactos reales. Mantener la referencia
   aprobada fija: un cambio de baseline/dataset requiere revisión explícita del equipo.
4. Configurar un remoto DVC accesible desde CI, subir ambos artefactos con
   `dvc push -r <remoto> golden/real.dvc models/regression.dvc` y guardar los punteros
   y el JSON en Git. No guardar credenciales. No publicar imágenes sensibles.
5. Configurar la variable de repositorio `HU22_DVC_REMOTE_URL` con un remoto de lectura
   autorizado sin credenciales (HTTP compatible con DVC). Si las imágenes son privadas,
   se necesita antes diseñar una ejecución confiable con acceso privado; este workflow
   de PR no recibe secretos. No usar `pull_request_target` para ejecutar código del PR.
6. Instalar `ml/requirements-regression.txt` en un entorno separado Python 3.11 y ejecutar:

   ```bash
   python -m ml.regression --config ml/regression-config.json --output reports/regression
   ```

TensorFlow CPU y operaciones deterministas; sin entrenamiento. Confirmar compatibilidad
de los checkpoints reales con el entorno fijado. No se ha probado su carga localmente.
Para reproducir también las dependencias transitivas, conservar `pip freeze` con la evidencia.

## CI y reportes

`.github/workflows/model-regression.yml` corre en PR abierto, actualizado, reabierto
o listo para revisión, además de ejecución manual. `regression-contract` ejecuta pruebas
sintéticas y verifica la reconstrucción DVC. `model-regression` intenta recuperar
los artefactos reales y ejecutar ambos modelos. Falta de remoto/configuración/datos
produce fallo explícito; nunca se transforma en aprobación sintética ni en omisión.
Los checks son independientes del workflow existente CI; configurar **HU22 real model
gate** como check requerido si el equipo quiere bloquear integración por regresión.

El artefacto de ejecución conserva reportes 14 días incluso tras fallo, sin imágenes
ni pesos. `regression.json` incluye política, decisión, hashes y todas las comparaciones;
`differences.csv` incluye ID, probabilidad original/nueva, veredicto original/nuevo y
`changed`. Código de salida **0**: 0, 1 o 2 cambios; **1**: 3 o más; **2**: error de
configuración, integridad o inferencia. Un fallo antes de predecir deja JSON de error.

## Revisión manual de criterios

Validación local realizada: suite ML completa **105 passed** (Python 3.11.4),
Ruff lint/formato correctos en `ml/`, workflow validado con `actionlint` sin errores.
JUnit local: `reports/hu22-tests.xml` (ignorado por Git). Los ensayos de inferencia
de HU22 emplean predictores simulados; no son resultados experimentales del modelo.
Se comprobó además la recuperación de las 50 imágenes sintéticas desde cache DVC
con el directorio original retirado del destino y coincidencia SHA256 del manifiesto.
Las dependencias instaladas están registradas localmente en `reports/hu22-environment.txt`.

| Criterio | Verificación |
| --- | --- |
| T01: reproducibilidad | Reconstruir fixtures en un clon limpio y comprobar que `git diff -- golden/synthetic.dvc` está vacío. Ejecutar `validate_golden`. |
| T01: 50 imágenes reales | Pendiente: preparar/push/pull del conjunto autorizado y revisar procedencia/etiquetas. Los fixtures no satisfacen este criterio real. |
| T02: eventos PR/evidencia | Abrir/actualizar PR; revisar ambos jobs y descargar artefactos, incluido el JSON de bloqueo cuando faltan recursos. |
| T02/T03: 0–2 pasan, 3+ fallan | Ejecutar `test_acceptance_and_reports`; casos 0,1,2,3,10. Confirmar JSON y CSV. |
| T03: correspondencia exacta | Ejecutar pruebas de IDs ausentes, repetidos, extraños; clases/contratos y umbral inválidos. |
| Integridad | Ejecutar casos de archivo ausente/corrupto, hash incorrecto y ruta fuera del conjunto. |
| Inferencia real | Pendiente: completar configuración y correr ambos checkpoints; revisar hashes y discrepancias en artefactos CI. |

Referencias: [DVC pull](https://doc.dvc.org/command-reference/pull),
[DVC checkout](https://doc.dvc.org/command-reference/checkout),
[Keras load_model](https://www.tensorflow.org/api_docs/python/tf/keras/models/load_model).
