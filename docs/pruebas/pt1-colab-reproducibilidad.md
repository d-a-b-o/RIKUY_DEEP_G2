# RIKDP-101 · Reproducibilidad ResNet50V2

Ejecutar la sección **Testing de ResNet50V2** del notebook actualizado, después de entrenar y exportar.
No copiar celdas ni rutas de corridas anteriores. El notebook es autocontenido y genera IDs automáticamente.

La celda crea dos entrenamientos nuevos con la misma configuración seleccionada, semilla y manifiesto.
Compara warmup, historial de fine-tuning y métricas/umbral de validation con tolerancia absoluta 1e-6.
Guarda `reports/resnet50v2-testing/RIKDP-101.json`, versiona ambas corridas y registra los experimentos.
Un aprobado requiere `passed=true` y `differences=[]`; no cambiar tolerancia para ocultar diferencias.

El notebook guardado contiene las dos ejecuciones ResNet (`52e198aa2f211cd968df` y `23e7de708676a8ddb819`)
y la finalización aprobada de las comparaciones. La salida se conserva también en
`docs/evidencias/RIKDP-101-notebook-output.txt`; es evidencia de ejecución guardada, no un entrenamiento local nuevo.
No repetir esta celda para obtener una comparación: añade dos entrenamientos al presupuesto.
Conservar `started.json`, `completed.json`, `warmup.csv`, `history.csv` y `validation.json`, y los pesos en DVC.

Para volver a comparar corridas completadas con los auxiliares, sincronizar el código actual y usar
`python -m ml.reproducibility --left RUTA_A --right RUTA_B`. El comparador acepta las identidades automáticas
del notebook y rechaza corridas de otra arquitectura. No hace falta repetir los fits ya aprobados.
También exige que `warmup.csv` figure en `completed.json` y compara sus métricas: un fine-tuning
idéntico no oculta diferencias de calentamiento. Conserva ambas fases antes de ejecutar el comparador.
