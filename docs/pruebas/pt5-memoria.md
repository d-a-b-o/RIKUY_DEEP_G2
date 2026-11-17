# RIKDP-230 · Video a 2 fps durante 10 minutos

Desde `apps/web`, con dependencias instaladas y Chromium de Playwright disponible:

```powershell
$env:PT5_MANIFEST_URL="https://bucket.d-a-b-o.dev/dev/manifest.json"
npm run test:memory
```

El ejecutor descarga el manifest, el grafo y los pesos reales antes de la medición.
Comprueba el hash del grafo si está declarado y registra SHA-256 de todos los
artefactos. Los sirve en un servidor efímero ligado a localhost. No usa cuentas,
base de datos, permisos de cámara ni escrituras de producción. La telemetría se
absorbe localmente para que no contamine las métricas del despliegue.

Procesa un `HTMLVideoElement` alimentado por `canvas.captureStream(2)` de 640×480,
con contenido cambiante. Usa `drawModelInput` y `loadInspectionModel` de producción,
con inferencias TensorFlow.js reales. Se registra el backend que selecciona el cargador.
Después de diez inferencias de estabilización toma la línea base y procesa 1.200
fotogramas con objetivos de inicio separados por 500 ms, sin adelantar el reloj.
Espera hasta completar al menos 600 segundos reales.

La aprobación requiere:

- 1.200 inferencias completas sin errores y diez minutos reales.
- Retraso máximo de inicio inferior a un período (500 ms).
- `numTensors`, `numDataBuffers` y `numBytes` iguales a la línea base tras cada
  inferencia; no se acepta crecimiento acumulativo.
- Al finalizar, los tres contadores vuelven a los valores previos a cargar el
  modelo y todas las pistas de video terminan.

El JSON de evidencia incluye muestras por fotograma, tiempos, backend, versión,
hashes, sistema operativo, CPU, navegador y commit base. El código nuevo y la
evidencia se incorporan en el mismo commit; el SHA del informe identifica la base
anterior a esa incorporación. `PT5_OUTPUT` permite elegir otro destino.

El resultado se limita a los contadores de recursos TensorFlow y al backend
ejecutado. No mide heap JavaScript completo, memoria de proceso, memoria GPU,
cámara física ni el flujo de estación con persistencia de inspecciones. Tampoco
valida exactitud industrial del modelo con las imágenes sintéticas. Una corrida
en un backend no acredita ausencia de fugas en los demás. Chromium habilita
SwiftShader para WebGL en equipos de prueba sin GPU física; no representa el
rendimiento de una GPU de planta.

La prueba larga es explícita y no pertenece a `npm test` ni al humo de cada PR.
El servidor y Chromium se cierran al terminar. Si falla una aserción, se conserva
el informe con `passed: false` y el proceso termina con código distinto de cero.

## Resultado de la corrida

La corrida registrada en [memory.json](../evidencias/RIKDP-230/memory.json) pasó:
modelo real 0.9.0, backend WebGL, 1.200 inferencias en 600.010,8 ms (aproximadamente
2 fps). Retraso máximo respecto a los inicios programados: 447,8 ms, inferior
al período de 500 ms. No se aceleró el reloj ni se saltaron inferencias.

Las 1.200 muestras conservaron exactamente 130 tensores, 130 buffers y 8.861.076
bytes, sin crecimiento respecto de la línea base posterior al calentamiento.
Tras `dispose()`, los tres contadores regresaron a cero y todas las pistas de
video quedaron detenidas. TensorFlow reportó `unreliable: false` para esos
contadores. No se observaron fugas de recursos TensorFlow en esta corrida;
se mantienen las limitaciones de alcance indicadas arriba.

