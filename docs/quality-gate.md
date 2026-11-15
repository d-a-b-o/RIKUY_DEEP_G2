# Quality gate TF.js · RIKDP-165

La celda de quality gate de `RIKUY_DEEP_G2.ipynb` evalúa la partición test fija del
manifiesto DVC: 195 imágenes (ambas clases), sin augmentation ni nuevo split.
No entrena. La comparación inicial de una imagen queda sustituida por este recorrido completo.

## Condiciones

- Accuracy ≥97% y recall de defectos ≥95% tanto en Keras como en TensorFlow.js.
- Como máximo 2 discrepancias de clasificación entre motores (RIKDP-154).
- Diferencia absoluta de probabilidades ≤0.0001 en todas las muestras.
- Cobertura exacta: sin IDs repetidos, imágenes omitidas, clases ausentes o probabilidades inválidas.
- Umbral y etiquetas de `preprocessing.json` iguales a los del modelo Python.
- Integridad de la corrida y la exportación; mismo manifiesto que se utilizó al entrenar.

Las condiciones de métricas y la necesidad de un control previo a publicar están
documentadas en `docs/arquitectura/README.md`. La tolerancia numérica de 1e-4 es
adicional a las discrepancias de clasificación y conserva el criterio del ensayo inicial.

## Ejecutar en Colab

1. Tener cargadas la corrida seleccionada y su exportación, con `selected_run` y `export_dir`.
2. Cargar las librerías y las funciones de preprocesamiento del notebook.
3. Ejecutar la celda con `run_golden_quality_gate`. Guarda tensores en
   `ROOT/reports/golden-quality-gate`, donde ROOT es
   `/content/drive/MyDrive/ColabNotebooks/RIKUY_DEEP_G2`. Keras usa CPU y TF.js usa
   WASM, con las versiones fijadas a 4.22.0. Carga `model.json` y los shards
   directamente del disco, sin localhost. No requiere el entorno del conversor.
4. Revisar `reports/quality_gate/<exportación>/quality_gate.json`, en el repositorio de Drive.

El reporte contiene las predicciones de cada imagen, las matrices de confusión,
discrepancias, métricas, umbral y hashes del modelo/conjunto dorado. Una ejecución
aprobada se reutiliza sólo si esos artefactos coinciden. Los fallos dejan reporte
y una excepción; `PUBLICATION_ALLOWED` comienza en `False` en cada ejecución.

No se modifica el contenido de `exports/` ni sus hashes después de exportar.
El runner guarda progreso después de cada predicción JavaScript. Al repetir la celda,
reutiliza sólo entradas que coinciden con los hashes del modelo, los pesos, las muestras
y el tensor correspondiente. Un timeout deja el gate incompleto y bloquea la publicación;
no demuestra por sí solo que el modelo incumpla las métricas. Se conserva el límite de
una hora por ejecución y no se reduce el conjunto de 195 imágenes para conseguir un aprobado.

El runner registra un adaptador `_FusedConv2D` para la limitación de WASM 4.22 con
sesgos `[1,1,1,C]`. Ejecuta Conv2D, BiasAdd y activación por separado, conservando
el broadcasting NHWC. No reescribe pesos ni archivos de la exportación. Rechaza
formatos, sesgos u operaciones no soportados. El reporte identifica este adaptador
con `execution_adapter=unfused-conv2d-nhwc-v1`; su resultado acredita este runner,
no el loader del navegador, que requiere su propia validación antes de publicar.

Las salidas del proceso se guardan en `node-stdout.log` y `node-stderr.log`, dentro
de la carpeta del ensayo. Si Node termina con error, su stderr también se incluye
en el reporte para evitar perder la causa detrás de un simple código de salida.

## Antes de publicar

La última celda, «Publicación protegida», llama a `publish_tfjs_version`, que ejecuta
obligatoriamente `assert_publication_ready()` antes de abrir el cliente remoto y
de nuevo después de subir los archivos, antes de cambiar `activeVersion`. Esta función vuelve a
comprobar hashes y recalcula la decisión desde las predicciones guardadas; no
acepta solamente un booleano aprobado de una sesión anterior.

```python
result = publish_tfjs_version(
    export_dir, selected_run, "1.0.0",
    assert_ready=assert_publication_ready,
    open_store=open_r2_model_store,
    dry_run=True,  # Verifica y genera plan; no abre R2 ni solicita credenciales.
)
```

El publicador está en `ml/publication.py` y también incluido íntegramente en el
notebook, que sigue siendo autocontenido. No usa un booleano `PUBLICATION_ALLOWED`
para decidir: vuelve a evaluar evidencia y hashes y captura los bytes exactos a subir.
Los `dvc push` previos son respaldos de artefactos, no activaciones de una versión pública.

### Simulación y publicación real

La celda usa `PUBLISH_MODEL=False` por defecto: imprime el plan y guarda un
comprobante local en `reports/publication/<versión>.json`. No requiere R2.
Para publicar deliberadamente, instalar `ml/requirements-publish.txt` al inicio,
escoger `MODEL_VERSION` nueva y configurar en el entorno (nunca en Git):

- `R2_ENDPOINT_URL`: endpoint HTTPS S3 de la cuenta de Cloudflare R2.
- `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`: credenciales con acceso al bucket de modelos.
- `R2_MODELS_BUCKET`: nombre del bucket público de modelos, separado del de imágenes privadas.

Después, ejecutar esa celda con `PUBLISH_MODEL=True`. Usa boto3 y API S3/R2; las
pruebas automatizadas no hacen estas operaciones contra una cuenta real.

### Orden y fallos

1. Gate obligatorio. Si falla: **cero llamadas al cliente remoto**.
2. Comprobar hashes de los bytes públicos y validar el contrato del manifest.
3. Leer catálogo y ETag. Un catálogo inválido, acceso denegado o versión ya registrada detiene la operación.
4. Subir exclusivamente `model.json`, shards, `preprocessing.json` y un resumen del gate,
   bajo `vX.Y.Z/`. No se publica `best.keras`, SavedModel ni las imágenes del conjunto dorado.
5. Volver a comprobar el gate antes de activar.
6. Escribir `manifest.json` al final, conservando el catálogo y usando `If-Match` con el ETag leído
   (o `If-None-Match: *` en la primera publicación). Una publicación concurrente no se pisa.

Los objetos de versión usan `If-None-Match: *` y caché inmutable. Un reintento puede
reutilizar objetos iguales de una subida parcial; bytes distintos producen un error.
Si falla la subida, el segundo gate o la escritura condicional, la versión no se
declara publicada y el manifest anterior permanece. Pueden quedar objetos inactivos
de una subida parcial: no se borran automáticamente.

La integración con la tabla `model_version` de la base de datos, descrita en ADR 0006,
es un paso de la publicación completa distinto del gate RIKDP-165 y no se ejecuta aquí.

La semántica de escrituras condicionales se basa en
[Cloudflare R2](https://developers.cloudflare.com/r2/api/s3/extensions/) y
[boto3 PutObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html).

## Alcance y evidencia pendiente

Este gate prueba la conversión y el umbral en TensorFlow.js WASM en Node con **tensores de
entrada idénticos**. No prueba todavía el recorte/resize mediante canvas ni los
backends WebGL/WASM del navegador. La prueba completa de inferencia del navegador
y paridad de preprocesamiento sigue correspondiendo a RIKDP-154/HU26.

Las pruebas de CI cubren aceptación/rechazo, cobertura de 195 IDs, finitud,
métricas y reutilización de la política en el notebook. El recorrido JavaScript
se comprueba además con un graph-model mínimo real: lectura de shards sin HTTP,
inferencia WASM y reanudación, incluyendo invalidación al cambiar un tensor.
Esta prueba no acredita el rendimiento ni la paridad del ResNet entrenado.
Las métricas reales del nuevo ResNet están pendientes de Colab. No se mantienen aprobaciones
de otra arquitectura como evidencia del modelo nuevo. Ver [el flujo ResNet de testing](pruebas/pt1-cierre.md).
La publicación permanece bloqueada hasta que el gate del nuevo checkpoint y exportación apruebe.
