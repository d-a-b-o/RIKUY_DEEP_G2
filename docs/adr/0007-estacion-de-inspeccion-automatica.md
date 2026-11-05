# 0007 · Estación de inspección automática en la línea de producción

- **Estado:** Aceptada (decisión del 2026-11-01, David Bravo)
- **Fecha:** 2026-11-01
- **Tareas:** HU44 (RIKDP-55), HU24, HU35, HU37, HU39

## Contexto

El objetivo del producto es **inspeccionar el 100 % de las piezas**, no una muestra. Para eso, RikuyDeep se instala como una estación fija sobre la línea de producción: una cámara apunta al punto por donde pasan las piezas y un computador las inspecciona solas, sin que una persona capture cada una.

Eso cambia supuestos del diseño inicial, que pensaba en un inspector delante de la pantalla:

- Nadie mira la pantalla de forma continua, así que una pieza defectuosa necesita un aviso que se note desde lejos.
- No hay una persona por inspección, sino una estación.
- El navegador queda abierto todo el turno.
- El volumen crece: a 1 pieza por segundo, una estación registra unas 28 800 inspecciones por turno de 8 horas.

## Decisión

**Estación**

- Una **estación** es un computador con cámara en un punto de una línea. Se registra en la base de datos (`station`) con su empresa, su línea y su configuración.
- Inicia sesión con una **cuenta técnica de rol `STATION`**, vinculada a la estación. Las inspecciones quedan a nombre de la estación, no de una persona.
- Funciona en **modo kiosco**: navegador a pantalla completa, sin barra de direcciones, con la pantalla siempre encendida (Screen Wake Lock API).
- Un operario la arranca al inicio del turno con el botón **«Iniciar estación»**. Ese gesto permite al navegador reproducir sonido y entrar en pantalla completa. A partir de ahí trabaja sola.
- Toma el **lote abierto asignado a la estación** y detecta el **turno activo** por la hora.

**Detección de piezas** (detalle en [inferencia en el navegador](../arquitectura/inferencia-navegador.md#estación-de-inspección-automática-hu44))

- Se calibra una imagen de referencia de la cinta vacía.
- Cada pieza pasa por: **llegada → quieta → inferencia (una sola vez) → salida**. Eso garantiza una inspección por pieza, sin duplicados ni fotogramas movidos.
- Ritmo de diseño: **hasta 1 pieza por segundo**, configurable por estación.

**Pieza defectuosa**

- **Alerta sonora y visual**: la pantalla completa en el color de defecto, el veredicto en grande y un sonido repetido hasta que un operario la reconoce. No se envían señales a un PLC ni a un expulsor en el MVP.

**Fotos**

- **Todas** las inspecciones se registran con su veredicto, confianza y versión del modelo.
- Se guarda la foto de **todas las defectuosas** y de **1 de cada N OK** (por defecto, N = 20, configurable por estación), para auditar y reentrenar sin saturar R2 ni la red de la planta.

**Continuidad**

- Las inspecciones y fotos pendientes se guardan en IndexedDB y se envían en lotes; si se cae la red, la estación sigue inspeccionando y sincroniza al volver.
- La estación se recarga sola si detecta un error irrecuperable (pérdida del contexto WebGL, cámara desconectada) y vuelve al estado anterior.

El modo manual con webcam (HU35) y la subida de imágenes (HU39) se mantienen para revisiones puntuales y para calibrar.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Inspector que captura cada pieza | Solo cubre una muestra y depende de la persona; es justo lo que el producto quiere superar |
| Aplicación nativa o servicio local en la planta | Más difícil de instalar y actualizar; el navegador ya tiene la inferencia con TF.js ([ADR 0002](0002-inferencia-en-el-navegador.md)) |
| Señal a un PLC o expulsor automático | Requiere hardware e integración específicos de cada planta; se deja para una fase posterior |
| Guardar la foto de todas las piezas | Unas 28 800 fotos por turno y estación; coste de almacenamiento y de red desproporcionado para el valor que aportan las OK |

## Consecuencias

- Positivas: inspección del 100 % de la producción; criterio constante durante todo el turno; trazabilidad de cada pieza; muestra de OK suficiente para auditar y reentrenar.
- Negativas o riesgos:
  - Un navegador abierto durante horas exige cero fugas de memoria y recuperación automática. Se prueba con una ejecución continua de 8 horas.
  - La calidad de la detección depende de la instalación: iluminación constante, fondo uniforme y cámara fija. Hace falta una guía de instalación.
  - A más de 1 pieza por segundo, la inferencia a 400×400 queda justa. Se mitiga cuantizando el modelo o con una versión a 224×224 ([ADR 0006](0006-manifest-de-modelos.md)).
  - Las OK sin foto no se pueden reevaluar con un modelo nuevo; solo su muestra.
  - El volumen de datos crece: el dashboard debe responder con cientos de miles de inspecciones (HU37).
