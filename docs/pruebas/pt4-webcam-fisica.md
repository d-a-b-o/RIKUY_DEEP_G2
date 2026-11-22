# PT4 · Prueba manual con webcam física en Chrome y Edge — RIKDP-191

Las pruebas automáticas usan la cámara simulada de Chromium. Esta prueba confirma el comportamiento con una **cámara real**, en los dos navegadores que usan las plantas, y en las dos pantallas que usan la cámara: inspección manual y estación automática.

## Preparación

- Equipo con webcam (integrada o USB), Chrome y Edge actualizados.
- Entorno: preview de `main` o producción, con una cuenta Inspector y la cuenta técnica de una estación. Sirven las de `npm run demo:uat`.
- Una pieza real o, si no hay, fotos impresas de una pieza OK y de una defectuosa. Buena luz y fondo liso.
- Anotar versión del navegador (`chrome://version` / `edge://version`), sistema operativo y modelo de cámara.

## Casos (repetir en Chrome y en Edge)

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Inspector → Inspeccionar → «Cámara». El navegador pide permiso → **Permitir**. | Se ve la imagen en vivo con la guía de encuadre. |
| 2 | Centrar la pieza OK en la guía y pulsar «Inspeccionar». | Veredicto «OK» con su confianza, en menos de 2 s desde el clic. |
| 3 | Repetir con la pieza (o foto) defectuosa. | Veredicto «Defectuosa». |
| 4 | Recargar la página y, cuando pida permiso, **Bloquear**. | Mensaje claro de que falta el permiso de cámara y cómo activarlo. La página no se rompe. |
| 5 | Volver a permitir el permiso desde el candado de la barra de direcciones y recargar. | La cámara vuelve a funcionar. |
| 6 | Con la cámara en uso, desconectar la cámara USB (o tapar o deshabilitar la integrada). | La página avisa del problema y no se queda colgada. |
| 7 | Cuenta de estación → Estación → «Iniciar» con la cámara mirando una superficie vacía. | Pantalla completa, calibración y luego «Esperando pieza». |
| 8 | Poner la pieza, dejarla quieta 1 s y retirarla. Repetir 5 veces. | Cada pieza se cuenta una sola vez y el contador de inspeccionadas sube de 1 en 1. |
| 9 | Con la estación iniciada, desconectar la cámara 10 s y reconectarla. | Aviso «Se desconectó la cámara. Reintentando…» y recuperación sola, sin perder lo que estaba por enviar. |

## Registro

| Caso | Chrome (versión) | Edge (versión) | Observaciones |
| --- | --- | --- | --- |
| 1 | | | |
| 2 (tiempo aprox.) | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 (piezas contadas / reales) | | | |
| 9 | | | |

Equipo y cámara: ……………… Sistema operativo: ……………… Fecha: ………… Probó: …………

**Criterio de aprobación:** los 9 casos pasan en ambos navegadores. Un fallo en los casos 2, 3 u 8 es crítico; en los demás, alto.
