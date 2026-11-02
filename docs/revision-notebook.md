# Revisión y uso del notebook RIKUY_DEEP

## Alcance

Se revisó `C:/Users/Rayke/Downloads/RIKUY_DEEP_G2.ipynb` (38 celdas,
SHA256 `a612c8e7948a442de26746fbaad68cd48716768cf04f180e7f2c98df161731da`).
El notebook que ya estaba en el repositorio tenía 36 celdas y contenido diferente.
La versión corregida está en la raíz del repositorio; el archivo de Descargas no fue modificado.
El notebook requiere el repositorio completo, especialmente `ml/workflow.py` y `ml/preprocessing.py`.

## Defectos encontrados en el archivo de Descargas

Los índices siguientes empiezan en cero y corresponden al archivo original.

| Celdas | Defecto | Consecuencia y corrección |
|---|---|---|
| 2 | Instalación en cada sesión; paquete `disutils` escrito incorrectamente; conversor TF.js mezclado con entrenamiento | Posibles errores de instalación y conflictos. Dependencias de entrenamiento en archivo separado; instalación fuera del flujo. |
| 4, 11, 15, 28, 33 | Imports y funciones repetidos | Una sola implementación importable, sin efectos al importar. |
| 6, 11, 15 | `ROOT`, `DATA_DIR`, `RAW_DATA` y `RAW_DIR` apuntan a lugares diferentes; `chdir` y rutas Colab obligatorias | Copias innecesarias, archivos no encontrados y ejecución dependiente del directorio actual. Configuración única con rutas explícitas. |
| 11, 13 | Dos llamadas consecutivas a `sync_dataset_with_dvc` | Doble pull/rsync/status. La segunda llamada puede indicar “sin cambios” y saltarse la publicación de la versión registrada por la primera. Se elimina la copia entre proyectos y la sincronización implícita. |
| 11 | `dvc pull` antes de copiar datos locales, errores capturados y sólo impresos | Riesgo de conflicto y continuación con estado incompleto. No hay pull automático; las excepciones detienen el flujo. |
| 11 | Dependencia de `rsync` y sincronización aditiva | Incompatible con Windows sin herramientas extra; quedan imágenes retiradas de la fuente. Se usa una fuente canónica sin merge. |
| 13 | `publish_version` condiciona todo push a `created_version` | Un push fallido no se reintenta en la siguiente ejecución. Se consulta el estado remoto independientemente del estado local. |
| 13, 26, 30, 31, 33, 35 | Publicación y staging mezclados con cómputo; `git push` directo | Efectos externos al ejecutar todo. DVC separado y apagado por defecto; sin operaciones Git automáticas. |
| 16 | Código de `preprocessing.py` como string escrito desde el notebook | Sobrescribe cambios del módulo y mantiene implementaciones divergentes. Se importa el módulo versionado. |
| 15, 17, 29 | La asignación de `branch` está comentada pero luego se usa | `NameError` dependiente del historial del kernel. Se elimina esa dependencia. |
| 21, 23 | Split recalculado y todas las imágenes reexportadas a JPEG | Trabajo repetido y recomprensión; posibles colisiones por `stem` o restos de particiones anteriores. Manifiesto persistente y resize durante lectura. |
| 21, 28 | La validación comprueba rutas, no imágenes idénticas entre splits | Leakage por copias con nombres diferentes. Deducción por contenido RGB antes del split y validación de hashes. |
| 28, 33 | Carpetas basadas sólo en timestamp | Reejecutar entrena todo y crea corridas nuevas. Identidad por datos, configuración, código y versiones; integridad de artefactos. |
| 31 | `model_aug`, `val_ds_aug`, `test_ds_aug`, `history_aug`, `HU10_AUG_OUT`, etc. no definidos | El archivo adjunto omite el entrenamiento augmentado que sí existe en otra versión del repositorio. Función `train(..., augmentation=True)` independiente. |
| 31 | `roc_curve` se usa antes del import de la celda 33 | Error tardío tras trabajo costoso. Métricas centralizadas con imports locales completos. |
| 33 | HPO exige `train_ds_aug` y otros globals de una sección anterior ausente | HPO no puede ejecutarse por sí solo. Cada etapa carga el mismo manifiesto. |
| 33 | Eliminación manual de MLflow/OpenTelemetry de `sys.modules`; base MLflow nueva por timestamp | Estado de librerías inconsistente y experimentos fragmentados. Se retira esa manipulación y se registran parámetros, entorno, código, manifiesto y métricas por corrida en JSON. |
| 1, 22, 25, 28, 32 | Diseño anuncia ResNet y ausencia de augmentation; ejecución usa MobileNetV2 y augmentation variable | Política explícita: CNN base, CNN augmentada y MobileNetV2 opcionales. |
| 37 | Exportación TF.js vacía | No existía exportación operativa. Sigue pendiente de un entorno de conversión compatible y prueba de equivalencia; no se presenta como terminada. |

## Cómo ejecutar

1. Usa un entorno Python dedicado con TensorFlow compatible con tu GPU. Instala
   `python -m pip install -r ml/requirements-train.txt` y reinicia el kernel.
2. Abre `RIKUY_DEEP_G2.ipynb` y ajusta `ROOT` al repositorio. En Colab monta Drive por separado.
3. Activa `download` y `prepare` en la primera ejecución; si ya tienes `data/casting_data`, sólo `prepare`.
   El flujo descarga la variante 512×512 con las dos clases, como el notebook original.
4. La descarga contiene las imágenes originales 512×512, no una versión previamente augmentada.
   `augmentation=True` es el valor predeterminado para CNN y MobileNetV2: aplica flip horizontal,
   rotación y brillo durante la lectura de train. Validation y test sólo se redimensionan y normalizan.
   No se guardan copias augmentadas ni aumenta el número de muestras de cada época; cambian las
   transformaciones aleatorias al entrenar.
   Activa `eda` para inspección. Activa los entrenamientos deseados: `cnn`, `hpo`.
   `cnn_no_aug` es un baseline opcional sin augmentation para comparar, apagado por defecto.
   HPO tiene cuatro corridas, máximo `hpo_epochs=10` cada una; CNN usa `epochs=35` por defecto.
5. Activa `evaluate` tras fijar las decisiones con validation. Para evaluar sin entrenar, indica `EXISTING_RUN`.
6. Activa `dvc_data` y/o `dvc_models` para registrar punteros locales. Para subir, configura un remoto
   DVC previamente, indica `DVC_REMOTE` y activa `PUSH_DVC`. Credenciales fuera del notebook y de Git.

Todos los interruptores empiezan apagados. Para cada etapa se comprueban los prerrequisitos cuando
se solicita; antes de entrenar se comprueban todas las imágenes y el manifiesto. Esto detecta errores
conocidos de forma anticipada, pero no puede garantizar que nunca aparezcan fallos de memoria,
hardware, credenciales o red durante una operación.

## Reejecución y recuperación

- Un manifiesto idéntico no se reescribe. Un cambio de fuente o semilla detiene la preparación:
  conserva el manifiesto anterior con DVC y retira explícitamente `data/prepared` antes de regenerar.
- Las corridas están en `models/experiments/<arquitectura>_<huella>`: `started.json`, `best.keras`,
  `history.csv`, `validation.json` y `completed.json`. Después de evaluar se agrega `test.json`.
  `started.json` incluye las versiones instaladas para reconstruir el entorno.
- Una corrida completa se reutiliza sólo si sus artefactos coinciden con sus hashes.
  Una carpeta incompleta se conserva y falla antes de reentrenar; cambia `experiment_tag` para una corrida nueva.
  No se implementa reanudación de entrenamiento desde una época intermedia.
- Tras evaluar una corrida ya versionada, vuelve a activar `dvc_models` para incluir el reporte.
- El registro local JSON no inicia un servidor MLflow. Una integración centralizada de MLflow puede
  añadirse posteriormente con un tracking URI estable y credenciales del entorno.

## Cambios experimentales y límites

Se mantiene la CNN original de cuatro bloques Conv/BatchNorm/ReLU/Pool, Dense(128) y dropout .35,
y MobileNetV2 con reescalado interno y BatchNormalization del backbone congelada.
El split ahora es estratificado por imagen RGB única y persiste en disco; no se usan las copias JPEG
procesadas ni el manifiesto CSV anterior. Esas carpetas antiguas se conservan, no se borran.
El umbral de ambas arquitecturas ahora maximiza precision sujeto al recall objetivo en validation
(antes la CNN usaba F1). La parada temprana y reducción de LR se han unificado en la función de entrenamiento.
Por estos cambios los resultados requieren una nueva evaluación; no son una reproducción numérica
de las métricas antiguas. Las dependencias tienen rangos de compatibilidad, no son un lock universal
GPU/CPU; cada corrida conserva el entorno real y la semilla. No se promete igualdad bit a bit entre equipos.

Los hashes detectan copias exactas de píxeles, no variantes rotadas, distintas tomas de una misma pieza
ni grupos físicos. Si la fuente ya está augmentada, confirma los grupos de origen antes de interpretar
las métricas como generalización a piezas nuevas. Sin IDs de grupo no se puede garantizar ausencia de ese leakage.

Las métricas y `history.csv` se conservan; las galerías de falsos negativos y gráficos de cada arquitectura
del notebook anterior no se generan automáticamente. EDA conserva conteos y dimensiones; la inspección
visual adicional puede hacerse sobre el manifiesto sin volver a entrenar.

El preprocesamiento Python redimensiona sin recortar. La web documenta recorte centrado: la equivalencia
debe resolverse y probarse antes de reemplazar el modelo desplegado.

## Verificación

Las pruebas de `ml/tests/test_workflow.py` usan imágenes sintéticas y comandos DVC simulados:
idempotencia, integridad, corrupción, etiquetas contradictorias, separación de splits y reintento remoto.
La CI también cubre cambios del notebook. No se descargó el dataset real ni se entrenó/publicó un modelo
durante esta revisión. Los ensayos de entrenamiento GPU, integración DVC real y conversión TF.js
deben ejecutarse en el entorno de entrenamiento, con sus credenciales y recursos.

Referencias: [DVC add](https://doc.dvc.org/command-reference/add),
[DVC status](https://origin-doc.dvc.org/command-reference/status),
[fine tuning y BatchNormalization](https://www.tensorflow.org/guide/keras/transfer_learning).
