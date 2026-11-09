# RIKDP-254 · Evaluar hojas impresas con webcam o celular

Estado: herramienta y procedimiento preparados; **faltan las capturas reales**.
Las imágenes sintéticas de los tests no acreditan este caso.

## Preparar las capturas

1. Imprimir imágenes del test reservado con etiqueta conocida OK/defectuosa.
   Mantener un registro de qué original corresponde a cada hoja.
2. Fotografiar o capturar las hojas con la webcam/celular que se usará en la demo.
   Reunir al menos 100 archivos distintos. Se recomienda 50 OK y 50 defectuosos.
   Variar distancia, encuadre e iluminación dentro del escenario previsto.
3. Una persona asigna la etiqueta según el original impreso; nunca usar la
   predicción del modelo como etiqueta real. Conservar el archivo capturado
   sin editarlo para mejorar el resultado. No incluir los originales digitales
   como si fueran capturas físicas.
4. Guardar los archivos de imagen JPG/JPEG/PNG en estas carpetas:

```text
data/capturas-pt1/
  ok_front/
    captura-001.jpg
    ...
  def_front/
    captura-051.jpg
    ...
```

La carpeta `data/` está excluida de Git. Conservar las fotos en Drive o el
almacenamiento acordado; en el repositorio se guarda el reporte de evaluación.
Anotar dispositivo, fecha, condiciones, originales impresos y quién etiquetó.

## Construir el inventario

Desde la raíz del repositorio, con el código actual de esta rama sincronizado:

```sh
python -m ml.capture_evaluation --prepare data/capturas-pt1 --device "Dispositivo, fecha y condiciones de captura"
```

Genera `data/capturas-pt1/manifest.json` con IDs, etiquetas y hashes. Exige
>=100 archivos únicos y ambas clases; rechaza duplicados, rutas externas,
archivos corruptos o modificados. No sobrescribe un manifiesto existente.
La herramienta no demuestra por sí sola que las fotos proceden de una cámara:
el origen y las etiquetas deben revisarse y documentarse por una persona.

## Evaluar sin reentrenar

En el entorno de ML con TensorFlow, indicar la corrida original restaurada:

```sh
python -m ml.capture_evaluation --manifest data/capturas-pt1/manifest.json --run RUTA_CORRIDA_ORIGINAL --output reports/captures/RIKDP-254.json
```

La referencia por defecto es `docs/evidencias/RIKDP-131-metricas.json`; debe
corresponder al mismo modelo, identidad y umbral. Para Colab, copiar también
esa referencia a la misma ruta de Drive o indicarla con `--baseline`.
Sincronizar los módulos `capture_evaluation.py`, `preprocessing.py`,
`regression.py` y `workflow.py` de esta rama antes de evaluar.

La evaluación corrige la orientación EXIF, convierte a RGB, recorta el cuadrado
centrado y aplica el resize half-pixel float32 validado en RIKDP-85. No aplica
augmentation, entrenamiento ni selección de umbral. Usa la inferencia Python
del modelo original; no es una prueba del flujo web completo ni de rendimiento.
Los decodificadores JPEG Python/navegador pueden tener diferencias numéricas.

El JSON contiene predicciones de cada foto, matriz, accuracy, recall y caída
en puntos porcentuales respecto al test reservado. También conserva tamaños de
clase, dispositivo declarado, hashes, runtime y política de objetivos. La caída
puede ser negativa si una métrica mejora; no se oculta ese resultado. Comparar
también la mezcla de clases, porque accuracy depende de su distribución.

`passed=true` significa que se completó una evaluación válida de >=100 capturas;
`meets_original_targets` indica por separado si alcanzó recall >=95 % y accuracy
>=97 %. El criterio de RIKDP-254 es medir y documentar la variación, incluso si
el modelo pierde rendimiento. Un fallo de configuración produce salida 2 y
`status=incomplete`, que no acredita la evaluación.

## Evidencia para cerrar

- JSON completo de evaluación, manifiesto y ubicación de las capturas.
- Dispositivo, fecha, condiciones y relación con originales impresos.
- Persona que verificó el origen físico y las etiquetas.
- Resumen de métricas de referencia/capturas, variación, ejemplos de fallos y
  limitaciones para la demo.

Conservar el modelo original y los datos; cualquier corrección del modelo será
una decisión posterior. La herramienta no publica artefactos ni cambia Jira.
