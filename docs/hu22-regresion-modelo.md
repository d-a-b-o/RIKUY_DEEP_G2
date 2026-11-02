# HU22 — RIKDP-33: regresión del modelo en CI

Subtareas: RIKDP-143 (conjunto dorado), RIKDP-144 (CI), RIKDP-273 (comparación).

## Artefactos reales y decisión

El usuario proporcionó las carpetas de Drive del proyecto y confirmó esta comparación:

- Base: HU17 `run01_lr1e-4_unfreeze15_drop30/best_model.keras`.
- Candidata: `mobilenetv2_af731904844ed80545ae/best.keras`.
- Umbral fijo de la base para ambos: **0.26489877700805664**. No se usa el umbral
  recalibrado de la candidata (0.24371959269046783).
- Dataset: 50 imágenes originales, 25 por clase, tomadas del split **test** del
  manifiesto existente `data/prepared/manifest.json`, ordenadas por ruta.
  No se crea otro split ni se cambian etiquetas.
- Resultado local real en CPU: **2 discrepancias / 50; aprobado** según HU22.
  Los IDs hu22-010 y hu22-018 cambian de OK a defectuosa. Son imágenes etiquetadas OK.
  El gate mide estabilidad de veredictos, no garantiza mejor precisión del candidato.

Los hashes, IDs públicos de Drive y procedencia están en `ml/regression-sources.json`.
El hash del checkpoint candidato coincide con su `completed.json` original.
Los checkpoints declaran entrada [None,400,400,3], Rescaling(2,-1) interno y Dense sigmoid.
La selección corresponde al split del manifiesto actual; no se ha reconstruido el
split histórico usado al entrenar HU17. Esta comparación no constituye una medición
independiente de generalización de ambos modelos.

## Arquitectura

- `ml/golden.py`: selección determinista de 25 imágenes test por clase y copia de
  bytes/etiquetas originales. Valida SHA256, decodificación, IDs únicos y ambas clases.
- `golden/real.dvc`: 50 imágenes reales y su manifiesto. `models/regression.dvc`:
  checkpoints base y candidato. Sólo los punteros se guardan en Git.
- `ml/regression-metadata/`: manifiesto y objetos de directorio DVC pequeños,
  con fin de línea LF fijado para preservar sus hashes entre Windows y Linux.
- `ml/regression_data.py`: descarga un paquete de objetos DVC desde Drive, verifica
  **SHA256 del paquete y SHA256/MD5 de cada objeto**, reconstruye un remoto local
  efímero y ejecuta `dvc pull` de los dos punteros. El paquete nuevo se guarda como
  `hu22-dvc-reference.zip` dentro del `dvc_remote` compartido; no reemplaza artefactos previos.
- `ml/regression.py`: carga los dos modelos Keras y compara por ID con cobertura
  exacta, mismo contrato y umbral; salida sigmoid [1,1], probabilidades finitas [0,1].
  Reutiliza `ml.preprocessing.preprocess_image`: RGB, resize bilinear 400×400,
  float32 /255; sin augmentation ni segunda normalización.
- `ml/regression-config.json`: rutas, contratos y SHA256 de los checkpoints.
  Un cambio de base, conjunto o umbral debe revisarse expresamente en el PR.
- Los 50 fixtures sintéticos siguen en `golden/synthetic.dvc`, separados y marcados
  como sintéticos. El gate real los rechaza. Sus etiquetas alternantes son de prueba.

Se conserva el quality gate Python/TF.js existente sin modificarlo. HU22 compara
versiones Keras, no el motor de navegador.

## Recuperar y ejecutar

Desde la raíz, con Python 3.11 y un entorno virtual activado:

```bash
pip install -r ml/requirements-regression.txt
python -m ml.regression_data
python -m ml.regression --config ml/regression-config.json --output reports/regression
```

La recuperación usa un paquete dentro del remoto que el usuario compartió mediante enlace público.
No requiere cookies, OAuth, secretos ni la variable HU22_DVC_REMOTE_URL.
El catálogo fija el paquete por ID/SHA256 y cada objeto por SHA256/MD5,
incluyendo los metadatos que DVC necesita. También conserva los IDs originales
para trazabilidad. Una sola descarga evita depender de 52 solicitudes consecutivas
a Drive; no se extraen rutas arbitrarias del ZIP.
El remoto `hu22-ci` se configura con `--local`, sin alterar `.dvc/config` versionado.

El mecanismo anterior con la ruta `/content/drive/...` dependía de un montaje de
Colab. Aquí el remoto efímero se hidrata con los archivos concretos compartidos.
Si Drive revoca permisos, limita descargas, modifica bytes o falta un archivo,
la recuperación falla y guarda JSON de error. Los reintentos de red son limitados.
No es una garantía de disponibilidad del servicio de Drive.

Para preparar una actualización autorizada del conjunto, usar el manifiesto fuente:

```bash
python -m ml.golden --source-manifest data/prepared/manifest.json --root . --output golden/nueva-referencia
dvc add golden/nueva-referencia
```

No sobrescribir la referencia vigente automáticamente. Actualizar y revisar punteros,
metadatos, catálogo, procedencia y hashes juntos. El generador exige un destino inexistente.

## Pruebas, lint y fixtures

```bash
pip install -r ml/requirements-ci.txt
python -m pytest -c ml/pytest.ini ml/tests
cd ml
ruff check .
ruff format --check .
cd ..
```

Para reconstruir fixtures en un clon limpio:

```bash
python -m ml.golden --output golden/synthetic
dvc add golden/synthetic
git diff --exit-code -- golden/synthetic.dvc
dvc checkout golden/synthetic.dvc
```

Pillow 13.0.0 en regresión y >=13,<14 en pruebas evitan las vulnerabilidades
de <=12.3.0 detectadas por dependency-review (p. ej. GHSA-5x8w-8jj5-q52h).

## CI y reportes

`.github/workflows/model-regression.yml` corre en PR abierto, actualizado, reabierto,
listo para revisión y manualmente. El job sintético prueba aceptación, errores y
reproducción DVC. El job real recupera el conjunto y modelos fijados y ejecuta
la comparación CPU con semilla fija y operaciones deterministas.

Regla: **0, 1 o 2 cambios aprueban; 3 o más rechazan**. Código de salida 0 aprueba,
1 indica regresión y 2 error de configuración, integridad, recuperación o inferencia.
Nunca se omite el gate por falta de recursos ni se transforma un error en aprobación.

`regression.json` incluye decisión, discrepancias, contrato, hashes y todas las
comparaciones. `differences.csv` incluye ID, probabilidad y veredicto original/nuevo
y `changed`. Filas ordenadas por ID, sin timestamps variables. Los reportes no
contienen imágenes ni pesos y se conservan como artefactos CI durante 14 días,
incluso tras fallo. La ejecución local guarda también versiones de Python/TensorFlow.

## Verificación de aceptación

| Criterio | Revisión |
| --- | --- |
| T01: 50 imágenes reales | Recuperar con ml.regression_data y ejecutar validate_golden; 25 etiquetas de cada clase, hashes y origen en el manifiesto. |
| T01: DVC reproducible | Recuperar en clon sin cache; comprobar dvc status sobre golden/real.dvc y models/regression.dvc, sin cambios. |
| T02: PR y evidencia | Actualizar PR, revisar ambos jobs y descargar JSON/CSV aunque falle la comparación. |
| T02/T03: frontera 2/3 | test_acceptance_and_reports cubre 0,1,2,3,10; test_runner_exit_codes_with_fake_keras verifica códigos del comando. |
| T03: correspondencia | Pruebas de IDs ausentes, duplicados/extraños, probabilidades, clases/contratos y umbral inválidos. |
| Integridad y descarga | test_regression_data cubre hashes, cache corrupta, descargas corruptas y rutas inválidas, sin red. |
| Regresión real | Ejecutar ambos checkpoints con el umbral confirmado y revisar las dos discrepancias del reporte. |

Las pruebas de contratos usan motores simulados y no se confunden con la ejecución
real documentada. Evidencia local: `reports/hu22-tests.xml` y `reports/regression/`
(ignorados por Git). La evidencia pública del PR proviene de los artefactos Actions.
Se conservan también `docs/evidence/hu22/local-regression.json` y
`local-differences.csv`: dos ejecuciones CPU con predicciones idénticas, incluida
una recuperación desde entorno sin cache. La suite final ejecutó **121 pruebas,
todas aprobadas**; Ruff y actionlint también pasaron.

Referencias: [DVC pull](https://doc.dvc.org/command-reference/pull),
[Keras load_model](https://www.tensorflow.org/api_docs/python/tf/keras/models/load_model).
