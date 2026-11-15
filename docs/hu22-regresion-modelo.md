# HU22 · Regresión ResNet50V2

El runner compara baseline y candidato de la misma arquitectura sobre 50 imágenes reales fijas:
0–2 cambios de veredicto aprueban; 3 o más rechazan. El preprocesamiento es RGB half-pixel 400×400 float32 [0,1],
contrato v2, y el umbral procede de validation. No se reutilizan pesos ni hashes de versiones retiradas.

La configuración y el catálogo quedan pendientes hasta que el notebook entrene, apruebe el gate y genere las
referencias nuevas. El ciclo completo y la publicación del bundle para CI están en [PT1](pruebas/pt1-cierre.md).
No se inicializa una referencia fingiendo hashes de pesos todavía no entrenados.

El workflow HU22 model regression conserva los tests sintéticos y el job real. Si falta la referencia nueva,
el job real devuelve error de configuración, distinto de un rechazo por discrepancias de un modelo degradado.
Los artefactos del job se conservan incluso al fallar.
