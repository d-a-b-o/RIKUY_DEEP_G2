# RIKDP-154 · Paridad de ResNet50V2 en el navegador

`ml/browser_model_parity.py` compara el checkpoint Keras versionado con su exportación TF.js
usando las 50 imágenes doradas reservadas (25 por clase). Compila e importa el **cargador real**
`apps/web/src/lib/model/loader.ts` y su preprocesamiento; no simula las predicciones.

Antes de inferir comprueba el checkpoint, la exportación, el gate original de 195 imágenes
y la pertenencia de cada imagen al test aprobado. Conserva hashes, predicciones individuales,
backend efectivo, versión de Chromium, métricas, discrepancias y recuento de tensores.
Falla con más de dos discrepancias, error de probabilidad superior a 1e-4,
accuracy inferior a 97 %, recall inferior a 95 % o tensores sin liberar.

## Ejecución sin entrenar

Instalar las dependencias de `ml/requirements-regression.txt`, ejecutar `npm ci` en `apps/web`
e instalar Chromium con `python -m playwright install chromium`.
Desde la raíz del proyecto, con `golden/real` y `models/regression` materializados por DVC:

```bash
python -m ml.browser_model_parity \
  --model models/regression/candidate.keras \
  --export exports/16958af143b39da2e2b6 \
  --golden golden/real \
  --source-gate reports/quality_gate/16958af143b39da2e2b6/quality_gate.json \
  --backend wasm \
  --output reports/browser-parity/RIKDP-154-wasm.json
```

En Colab, situarse primero en `/content/drive/MyDrive/ColabNotebooks/RIKUY_DEEP_G2`.
`--export` necesita `completed.json` y la carpeta `web/` completa, incluidos todos los `.bin`.
Para WebGL repetir con `--backend webgl` y otro archivo de salida. Se exige el backend solicitado:
un fallback a WASM no se registra como prueba de WebGL.

## Compatibilidad del grafo

El exportador produce `_FusedConv2D` con un sesgo `[1,1,1,C]` que el kernel fusionado de WASM
no admite. La web registra las mismas operaciones descompuestas del notebook: convolución,
sesgo y activación, sin modificar pesos. Las pruebas ejecutan la matemática real y comprueban
resultados, errores de configuración y liberación de tensores. También se registra el backend CPU
que el cargador ofrecía como último recurso.

## Alcance de la evidencia

Se decodifica cada JPEG con Pillow y se transportan sus píxeles RGB al navegador como PNG sin pérdida.
Así ambos reciben los mismos píxeles; el recorte, resize, normalización e inferencia usan el código web.
Los archivos se sirven mediante rutas interceptadas de Playwright, sin servidor HTTP ni acceso externo.
La prueba no mide diferencias entre decodificadores JPEG ni sustituye las 100 capturas físicas de RIKDP-254.
Chromium headless con SwiftShader tampoco acredita rendimiento gráfico de un dispositivo físico.

La comparación adicional de 50 imágenes **no reemplaza** el gate de publicación de 195 imágenes.
Los reportes aprobados se conservan en `docs/evidencias/RIKDP-154-browser-*.json` y el gate original
en `docs/evidencias/RIKDP-154-quality-gate-resnet.json`. No subir checkpoints ni shards al repositorio.

## Comprobaciones locales de esta revisión

Resultados del 16/11/2026, con TensorFlow 2.20.0, Keras 3.15.1 y TF.js 4.22.0:

| Backend Chromium | Imágenes | Discrepancias | Máxima diferencia de probabilidad | Accuracy / recall |
| --- | --- | --- | --- | --- |
| WASM | 50 | 0 | 6,854534149169922e-7 | 100 % / 100 % |
| WebGL (SwiftShader) | 50 | 0 | 5,662441253662109e-7 | 100 % / 100 % |

Ambos mantuvieron estable el número de tensores entre predicciones y terminaron con cero tensores vivos.
Los JSON registran las versiones exactas y hashes; repetir el ensayo si cambia el modelo o el cargador.

Pasaron lint y TypeScript de la web, las 66 pruebas del módulo de modelos y las pruebas ML.
La suite ML terminó con 200 pruebas y cuatro subpruebas aprobadas.
La suite web completa no pudo ejecutar 12 suites que necesitan `DATABASE_URL`.
El build completo se detuvo en el procesamiento CSS de Turbopack por un error al iniciar su proceso Node.
Estas dos comprobaciones deben completarse en el entorno con base de datos y compilación configuradas;
no se ha omitido ningún control de CI ni modificado la configuración para ocultar esos resultados.
