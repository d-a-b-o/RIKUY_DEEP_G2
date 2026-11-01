# 0002 · Inferencia del modelo en el navegador con TensorFlow.js

- **Estado:** Propuesta
- **Fecha:** 2026-11-01
- **Tareas:** RIKDP-86 (HU07-T01), HU25, HU26, HU35, HU44

## Contexto

Hasta el 28/10/2026 el plan incluía un servicio de inferencia en Python (FastAPI, `apps/inference`). Con un equipo de tres personas, mantener y desplegar un servidor con GPU o CPU dedicada, más su escalado, no es viable. Además, la inspección en video (HU44) necesita varias inferencias por segundo, y enviar cada fotograma a un servidor añadiría latencia y coste.

## Decisión

El modelo se exporta a **TensorFlow.js** (graph model) y se ejecuta en el navegador del inspector:

- Backend **WebGL**, con **WASM** como alternativa si WebGL no está disponible.
- El modelo se descarga desde R2 según el `manifest.json` y se guarda en **IndexedDB**, para no descargarlo en cada visita.
- El preprocesamiento en TF.js replica exactamente `ml/preprocessing.py`.
- Cada inspección registra el **veredicto, la confianza, el umbral aplicado y la versión del modelo**.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Servidor de inferencia (FastAPI) | Un servicio más que desplegar, escalar y pagar; latencia de red en cada fotograma |
| Inferencia serverless (Vercel Functions o Lambda con TF) | Arranques en frío con modelos pesados y límites de tamaño del paquete |
| API de visión de terceros | Coste por imagen y datos de producción del cliente fuera de su control |

## Consecuencias

- Positivas:
  - Sin coste de cómputo de inferencia en servidor.
  - Baja latencia: objetivo p95 < 500 ms por imagen tras el calentamiento (HU26).
  - Las imágenes solo salen del navegador para guardarse como evidencia.
- Negativas o riesgos:
  - **El veredicto lo calcula el cliente** y un usuario podría manipularlo. Se acepta en el MVP porque los inspectores son empleados autenticados de la empresa, y se mitiga guardando la imagen original y la versión del modelo, lo que permite auditar o reevaluar cualquier inspección.
  - El rendimiento depende del equipo del inspector. Se define un equipo de referencia y se registra el tiempo de inferencia (HU43).
  - El modelo es descargable públicamente. Es aceptable: no contiene datos de clientes.
  - La CSP debe permitir WebGL y WASM (`'wasm-unsafe-eval'`, HU48).
  - Hay que garantizar la paridad Keras ↔ TF.js (HU25) y la ausencia de fugas de memoria liberando tensores (HU44).
  - El tamaño de entrada del modelo debe quedar fijado. Hoy `ml/preprocessing.py` usa 400×400 y HU26 dice 224×224; se resuelve en RIKDP-88.
