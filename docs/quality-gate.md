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

1. Recuperar el modelo existente y la exportación, con `selected_run` y `export_dir`.
2. Cargar las librerías y las funciones de preprocesamiento del notebook.
3. Ejecutar la celda con `run_golden_quality_gate`. Crea tensores temporales en `/content` y realiza las
   inferencias en CPU; puede tardar varios minutos. No requiere el entorno del conversor.
4. Revisar `reports/quality_gate/<exportación>/quality_gate.json`, en el repositorio de Drive.

El reporte contiene las predicciones de cada imagen, las matrices de confusión,
discrepancias, métricas, umbral y hashes del modelo/conjunto dorado. Una ejecución
aprobada se reutiliza sólo si esos artefactos coinciden. Los fallos dejan reporte
y una excepción; `PUBLICATION_ALLOWED` comienza en `False` en cada ejecución.

No se modifica el contenido de `exports/` ni sus hashes después de exportar.
Los datos temporales de `/content` se pueden reconstruir tras una desconexión.

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

Este gate prueba la conversión y el umbral en TensorFlow.js CPU con **tensores de
entrada idénticos**. No prueba todavía el recorte/resize mediante canvas ni los
backends WebGL/WASM del navegador. La prueba completa de inferencia del navegador
y paridad de preprocesamiento sigue correspondiendo a RIKDP-154/HU26.

Las pruebas de CI cubren aceptación/rechazo, cobertura de 195 IDs, finitud,
métricas y reutilización de la política en el notebook. El recorrido JavaScript
se prueba con un motor simulado; no se confunde con una ejecución del modelo real.
El gate de las imágenes reales se ejecutó en Colab: el usuario aportó un reporte
de 195 muestras, 98.46% de accuracy, 100% de recall, cero discrepancias y diferencia
máxima de 3.0994415283203125e-06. No se volvió a ejecutar ese modelo en la revisión local.

`ml/tests/test_publication.py` usa un cliente S3 simulado para demostrar que el gate
fallido bloquea todas las escrituras, que la subida precede a la activación y que
fallos intermedios o conflictos no cambian la versión activa. No se ha realizado
una publicación real en R2 durante esta tarea.
