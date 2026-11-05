# 0006 · Manifest de modelos para versionar y revertir sin desplegar

- **Estado:** Aceptada (revisión de arquitectura del 2026-11-01, RIKDP-89)
- **Fecha:** 2026-11-01
- **Tareas:** RIKDP-88 (HU07-T03), HU25, HU26

## Contexto

El modelo cambia más a menudo que la aplicación: cada reentrenamiento produce una versión nueva con su propio umbral calibrado. Publicar un modelo no debería exigir desplegar la web, y si una versión se comporta mal en producción hay que poder volver a la anterior en minutos (HU25). Además, la web debe saber cómo preprocesar las imágenes para cada versión.

## Decisión

- Cada versión se publica en R2 en su propia carpeta inmutable (`v1.0.0/model.json` + shards).
- Un archivo `manifest.json` en la raíz del bucket indica la **versión activa** y describe cada versión publicada: ruta del modelo, hash, entrada (tamaño y normalización), salida, **umbral** y métricas.
- El navegador descarga el manifest sin caché en cada carga de la página de inspección, y el modelo de la versión activa desde IndexedDB si ya lo tiene.
- Volver atrás es cambiar `activeVersion` en el manifest.
- La web valida el manifest antes de usarlo (`apps/web/src/lib/model/manifest.ts`).

Diseño completo en [inferencia en el navegador](../arquitectura/inferencia-navegador.md).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Ruta del modelo fija en el código de la web | Cada modelo nuevo exigiría desplegar la aplicación; revertir también |
| Versión activa en la base de datos, servida por una API | Una petición más al servidor en cada carga; el manifest estático en R2 es más simple y UptimeRobot puede vigilarlo (HU43) |
| Sobrescribir siempre `latest/model.json` | Sin historial ni reversión, y problemas de caché en los navegadores |

## Consecuencias

- Positivas: publicar y revertir sin desplegar; cada inspección guarda la versión exacta y el umbral aplicado; caché larga e inmutable para los pesos.
- Negativas o riesgos:
  - Un manifest mal formado dejaría a todos sin modelo. Se mitiga validándolo en el CI antes de publicarlo y en la web antes de usarlo, y usando la última versión en caché si falla.
  - El manifest y la tabla `model_version` deben mantenerse coherentes; el job de publicación (HU25) actualiza ambos.
