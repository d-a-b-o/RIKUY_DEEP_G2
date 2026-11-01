# Inferencia en el navegador y manifest de modelos

Diseño de cómo la web carga el modelo, lo ejecuta con TensorFlow.js y cambia de versión sin desplegar la aplicación.

Tarea: RIKDP-88 (HU07-T03 · diseño de la inferencia en el navegador y del manifest de modelos). Lo implementan HU25 (exportación y publicación) y HU26 (inferencia en la web).

Decisiones relacionadas: [ADR 0002 · inferencia en el navegador](../adr/0002-inferencia-en-el-navegador.md) y [ADR 0006 · manifest de modelos](../adr/0006-manifest-de-modelos.md).

## El modelo actual

Datos del notebook `RIKUY_DEEP_G2.ipynb` (HU17, corrida `run01_lr1e-4_unfreeze15_drop30`):

| Propiedad | Valor |
| --- | --- |
| Arquitectura | MobileNetV2 (ImageNet) con fine-tuning, `GlobalAveragePooling2D`, `Dropout`, `Dense(1, sigmoid)` |
| Entrada | `[1, 400, 400, 3]`, RGB, `float32` en **[0, 1]** |
| Normalización interna | Capa `Rescaling(2, offset=-1)` dentro del modelo: pasa de [0, 1] a [-1, 1]. **La web no la aplica** |
| Salida | `[1, 1]`: probabilidad de que la pieza sea **defectuosa** (clase 1) |
| Umbral | **0,2649**, elegido en validación para priorizar el recall de defectuosas |
| Métricas en test | accuracy 98,97 %, recall de defectuosas 98,29 %, precisión de defectuosas 100 %, 2 falsos negativos de 117 |

El tamaño de entrada es **400×400**. Se decidió en la revisión de arquitectura del 2026-11-01 (RIKDP-89); HU06 y HU26 decían 224×224 y se corrigieron.

## Exportación (HU25)

1. Cargar el mejor checkpoint `best_model.keras` y exportarlo como SavedModel: `model.export("export/saved_model")`.
2. Convertir a graph model:

   ```bash
   tensorflowjs_converter \
     --input_format=tf_saved_model \
     --output_format=tfjs_graph_model \
     --signature_name=serving_default \
     export/saved_model export/tfjs
   ```

   Se usa *graph model* y no *layers model* porque carga y ejecuta más rápido en el navegador, y no necesita reconstruir las capas de Keras.

3. Verificar la paridad Keras ↔ TF.js en el conjunto dorado (como mucho 2 discrepancias, RIKDP-154) y el quality gate de métricas.
4. Publicar en R2 y actualizar el manifest (ver más abajo).

## Estructura en R2

Bucket público de modelos, servido detrás de un dominio propio (por ejemplo `models.rikuydeep.app`):

```text
manifest.json                      ← versión activa y catálogo de versiones
v1.0.0/
  model.json                       ← topología + índice de pesos
  group1-shard1of4.bin             ← pesos
  …
v1.1.0/
  …
```

| Objeto | `Cache-Control` | Por qué |
| --- | --- | --- |
| `manifest.json` | `no-cache` | Cambiar de versión debe notarse en la siguiente carga |
| `v*/**` | `public, max-age=31536000, immutable` | Una versión publicada nunca cambia; si hay que corregirla, se publica otra |

El bucket necesita CORS con `GET` permitido para el dominio de la app.

## Manifest

Esquema: [`apps/web/src/lib/model/manifest.ts`](../../apps/web/src/lib/model/manifest.ts) (tipos y validación, con pruebas). Ejemplo:

```json
{
  "schemaVersion": 1,
  "activeVersion": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "modelPath": "v1.0.0/model.json",
      "modelSha256": "<sha256 de model.json>",
      "publishedAt": "2026-11-15T12:00:00Z",
      "input": {
        "width": 400,
        "height": 400,
        "channels": 3,
        "scale": 0.00392156862745098,
        "offset": 0
      },
      "output": {
        "activation": "sigmoid",
        "positiveLabel": "DEFECTIVE",
        "negativeLabel": "OK"
      },
      "threshold": 0.2649,
      "metrics": {
        "testAccuracy": 0.9897,
        "testDefectRecall": 0.9829,
        "mlflowRunId": "<run id>"
      }
    }
  ]
}
```

Reglas:

- `activeVersion` debe existir en `versions`. **Volver atrás es cambiar `activeVersion`** a una versión anterior (HU25).
- `modelPath` es relativo a la URL del manifest.
- `input.scale` y `input.offset` describen la normalización que aplica la web: `valor = píxel × scale + offset`. Para el modelo actual, `1/255` y `0`.
- `threshold` acompaña a la versión: un modelo nuevo puede tener otro umbral calibrado.
- Cada versión publicada se registra también en la tabla `model_version` (ver [modelo de datos](modelo-datos.md)).

## Flujo de carga

```mermaid
sequenceDiagram
  autonumber
  participant P as Página de inspección
  participant M as manifest.json (R2)
  participant C as IndexedDB
  participant R as Modelo (R2)

  P->>M: GET manifest.json (no-cache)
  alt Manifest disponible
    M-->>P: activeVersion = 1.0.0
    P->>C: ¿Existe indexeddb://rikuydeep-model-1.0.0?
    alt En caché
      C-->>P: Modelo
    else No está
      P->>R: GET v1.0.0/model.json + shards
      R-->>P: Modelo
      P->>C: Guardar 1.0.0 y borrar versiones antiguas
    end
  else Manifest no disponible
    P->>C: Última versión en caché
    Note over P,C: Si no hay ninguna, la inspección se bloquea<br/>con un mensaje claro y se registra el error
  end
  P->>P: Elegir backend: WebGL, si falla WASM
  P->>P: Calentamiento: una inferencia con un tensor de ceros
  P-->>P: Listo para inspeccionar
```

Detalles:

- **Clave de caché:** `indexeddb://rikuydeep-model-<versión>`. Se guarda con `model.save()` y se carga con `tf.loadGraphModel()`. Al activar una versión nueva se borran las antiguas para no llenar el almacenamiento.
- **Integridad:** si `modelSha256` está presente, se comprueba el hash de `model.json` antes de cargarlo.
- **Backend:** `await tf.setBackend("webgl")`; si falla, `@tensorflow/tfjs-backend-wasm`. Los binarios `.wasm` se sirven desde el propio dominio para cumplir la CSP (`'wasm-unsafe-eval'`, HU48).
- **Calentamiento:** la primera inferencia en WebGL compila shaders y es lenta. Se ejecuta una con ceros al cargar y no se cuenta en las métricas de latencia.

## Preprocesamiento: Python ↔ TensorFlow.js

La web debe reproducir exactamente el preprocesamiento del entrenamiento (`ml/preprocessing.py`):

| Paso | Entrenamiento (Python) | Web (TensorFlow.js) |
| --- | --- | --- |
| 1. Encuadre | Imágenes del dataset ya cuadradas | Recorte cuadrado centrado del fotograma o la imagen (la guía de encuadre de HU35 marca ese cuadrado) |
| 2. Redimensionado | `PIL.Image.resize((400, 400), BILINEAR)` | Dibujar el recorte en un `<canvas>` de 400×400 con `imageSmoothingQuality = "high"` |
| 3. Canales | `convert("RGB")` | `tf.browser.fromPixels(canvas, 3)` |
| 4. Tipo y escala | `float32 / 255` | `.toFloat().mul(scale).add(offset)` con los valores del manifest |
| 5. Lote | — | `.expandDims(0)` → `[1, 400, 400, 3]` |
| 6. [-1, 1] | Dentro del modelo | Dentro del modelo |

Se redimensiona con el canvas y no con `tf.image.resizeBilinear` porque los fotogramas de la cámara (por ejemplo 1280×720) se **reducen**, y el bilineal de TF.js no suaviza al reducir, mientras que PIL sí. Esa diferencia produce bordes dentados y cambia la predicción. La paridad se comprueba en el conjunto dorado (RIKDP-154).

## Postprocesamiento

```text
p = probabilidad de defecto (salida del modelo)
veredicto = DEFECTIVE si p ≥ threshold, OK en otro caso
confianza = p si DEFECTIVE, 1 − p si OK
```

La función `classify()` de `apps/web/src/lib/model/manifest.ts` lo implementa y tiene pruebas. Se guardan en la inspección `predicted_verdict`, `confidence`, `threshold_applied` y `model_version_id`.

Con un umbral de 0,2649, una pieza con `p = 0,30` es **defectuosa con confianza 0,30**. Es lo esperado: el umbral bajo prioriza no dejar pasar defectos. La interfaz debe mostrar el veredicto de forma destacada y la confianza como dato secundario.

## Estación de inspección automática (HU44)

La estación inspecciona sola cada pieza que pasa por la línea ([ADR 0007](../adr/0007-estacion-de-inspeccion-automatica.md)). El reto es inspeccionar **cada pieza exactamente una vez**: ni dos veces la misma pieza, ni una pieza movida o a medio entrar en el encuadre.

### Detección de piezas

La detección no usa el modelo de IA, que es costoso. Usa una comparación barata de fotogramas:

- Cada 100 ms (10 fps) el fotograma se reduce a 64×64 en escala de grises con un `<canvas>`.
- **Presencia:** diferencia media con la imagen de referencia de la cinta vacía, tomada al calibrar.
- **Movimiento:** diferencia media con el fotograma anterior.

```mermaid
stateDiagram-v2
  [*] --> Vacia
  Vacia --> Llegando: presencia > umbral
  Llegando --> Quieta: movimiento < umbral durante 3 fotogramas
  Llegando --> Vacia: presencia < umbral
  Quieta --> Inspeccionada: una inferencia con el modelo
  Inspeccionada --> Saliendo: presencia baja o movimiento alto
  Saliendo --> Vacia: presencia < umbral durante 3 fotogramas
  Llegando --> Inspeccionada: no se detuvo en 2 s (inferencia con aviso)
```

- La inferencia ocurre **una sola vez por pieza**, en el estado *Quieta*. Hasta que la escena vuelve a *Vacía*, no se inspecciona otra.
- Si la pieza no llega a detenerse en 2 s (la cinta no para), se infiere con el fotograma más nítido y la inspección se marca con un aviso de movimiento.
- Si aparece una pieza nueva sin que la escena se vacíe entre ambas (piezas pegadas), se registra un aviso de conteo dudoso para revisarlo.

### Parámetros por estación

Se guardan en `station.config` y se ajustan al calibrar:

| Parámetro | Por defecto | Para qué |
| --- | --- | --- |
| `presenceThreshold` | 0,12 | Diferencia con el fondo que indica que hay una pieza |
| `motionThreshold` | 0,02 | Diferencia entre fotogramas por debajo de la cual la pieza está quieta |
| `stableFrames` | 3 | Fotogramas quietos seguidos antes de inferir |
| `maxWaitMs` | 2000 | Espera máxima antes de inferir con aviso de movimiento |
| `okPhotoEvery` | 20 | Se guarda la foto de 1 de cada N piezas OK |
| `targetPiecesPerSecond` | 1 | Ritmo esperado de la línea, para avisar si se supera |

### Presupuesto de tiempo a 1 pieza por segundo

| Paso | Tiempo |
| --- | --- |
| Llegada y espera a que la pieza quede quieta (3 fotogramas a 10 fps) | 300 ms |
| Preprocesamiento y una inferencia a 400×400 en WebGL | 300 ms |
| Registro local, alerta y pantalla | < 50 ms |
| **Total por pieza** | **≈ 650 ms** |

Queda margen hasta 1 pieza por segundo. Por encima, la estación avisa de que la línea va más rápido que su capacidad.

### Pieza defectuosa

- La pantalla completa pasa al color `defect` con el texto «DEFECTUOSA» en grande, el número de pieza y la confianza.
- Un sonido corto se repite cada 2 s (Web Audio API) hasta que un operario pulsa **«Pieza retirada»** o una tecla.
- El veredicto nunca depende solo del color: siempre hay texto.

### Fotos y envío

- Cada inspección se guarda primero en IndexedDB.
- La foto se conserva si la pieza es **defectuosa** o es la OK número N desde la última guardada (`okPhotoEvery`).
- Un proceso en segundo plano envía al servidor los registros en lotes (cada 5 s o cada 50 inspecciones) y sube las fotos a R2 con URL prefirmada ([ADR 0005](../adr/0005-subida-directa-a-r2.md)).
- Si no hay red, la cola crece y la estación sigue inspeccionando. Si la cola supera un límite de almacenamiento, se avisa en pantalla.

### Funcionamiento continuo

- Pantalla siempre encendida con `navigator.wakeLock.request("screen")`, renovado al volver a la pestaña.
- Todo el trabajo con tensores dentro de `tf.tidy()`, y los resultados se leen con `await tensor.data()`.
- Prueba de fugas: `tf.memory().numTensors` debe permanecer estable durante una ejecución de 8 horas.
- Si se pierde el contexto WebGL o la cámara se desconecta, la estación muestra el problema, espera y se recarga sola, conservando la cola pendiente.

### Pantalla de la estación

Contadores del turno siempre visibles: piezas inspeccionadas, OK, defectuosas, porcentaje de defectos y ritmo actual (piezas por minuto), junto con el lote, el turno y la versión del modelo.

## Telemetría (HU43)

Por cada inferencia se mide la duración (sin el calentamiento) y el backend. Se envían en lotes a `model_telemetry`. Los errores de carga del manifest o del modelo se registran con su mensaje.

## Rendimiento

400×400 cuesta unas 3,2 veces más cómputo que 224×224. Objetivo de HU26: **p95 < 500 ms** por imagen tras el calentamiento, en el equipo de referencia. Si no se cumple, las opciones por orden son:

1. Cuantizar los pesos a `float16` con `--quantize_float16` (la mitad de tamaño de descarga, sin cambiar la entrada).
2. Reentrenar a 224×224 y publicarlo como una versión nueva del manifest.

## Pruebas

| Prueba | Tarea |
| --- | --- |
| Validación del manifest y de `classify()` | `apps/web/src/lib/model/manifest.test.ts` |
| Paridad Keras ↔ TF.js en el conjunto dorado | RIKDP-154 |
| Inferencia con imágenes OK, defectuosas e inválidas | RIKDP-158 |
| Modelo degradado hace fallar la regresión en CI | RIKDP-145 |
