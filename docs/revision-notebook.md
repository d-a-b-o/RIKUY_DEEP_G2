# Revisión y uso del notebook RIKUY_DEEP

## Flujo vigente

El notebook raíz es autocontenido: instalación, librerías centralizadas,
configuración YAML, inicialización DVC, descarga, validación y split,
augmentation sólo en train, CNN baseline, ResNet50V2 y evaluación.

ResNet50V2 utiliza ImageNet, entrada 400×400 RGB [0,1] y normalización interna
[-1,1]. Primero adapta la cabeza con la base congelada; después descongela la
fracción superior, mantiene BatchNormalization congelada y recompila antes del
fine-tuning. Compara cuatro configuraciones mediante validation. El test no
selecciona ni el modelo ni el umbral.

## Versionado nuevo

No se recuperan corridas eliminadas. Cada entrenamiento del notebook crea su
identificador automáticamente, sin etiquetas manuales. La raíz fija en Colab es
`/content/drive/MyDrive/ColabNotebooks/RIKUY_DEEP_G2`. Todas las rutas de trabajo
se derivan de ella: `.cache/` para imágenes, DVC, descargas y temporales;
`.tools/` para Python y el conversor TF.js; `reports/` para pruebas;
`dvc_remote/` para el almacenamiento nuevo de objetos DVC.

`RIKUY_DVC_REMOTE_URL` es opcional y sólo admite una subcarpeta de esta raíz,
separada de los datos y cachés. Las carpetas de caché, herramientas y objetos
se excluyen de Git. DVC se inicializa si falta y configura su ruta privada
en .dvc/config.local. Cada etapa registra sus
punteros y sincroniza objetos con el almacenamiento nuevo. Sólo los punteros,
configuración sin secretos y notebook limpio se llevan a GitHub.

Los módulos auxiliares aceptan CNN/ResNet50V2; el flujo principal permanece en
el notebook. Los ejemplos seleccionan el modelo desde
`data/prepared/final-selection.json`, no desde una corrida codificada a mano.

## Validación y entrega

Las pruebas verifican separación de datos, augmentation sólo en train,
adaptación de cabeza antes del fine-tuning, recompilación y generación de
corridas nuevas. El entrenamiento GPU, las métricas, el versionado remoto y la
conversión de los pesos nuevos deben ejecutarse en Colab. La publicación queda
sujeta al gate y no se activa durante las pruebas locales.

Las evidencias históricas no acreditan el nuevo modelo. Actualizar los hashes,
punteros y referencias de regresión únicamente después de generar y verificar
los nuevos artefactos. No sustituir nombres de arquitectura dentro de informes
antiguos conservando sus porcentajes como si fueran resultados nuevos.
