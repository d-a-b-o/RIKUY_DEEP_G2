# Rendimiento: Lighthouse de la landing (RIKDP-109) y captura → veredicto (RIKDP-196)

Mediciones del 2026-11-22 sobre la compilación de producción de `main` (`5b87b7e`), servida en local con `next start`.

## RIKDP-109 · Lighthouse ≥ 90 en la landing

Lighthouse 13.5.0, Chromium sin interfaz, URL `/`, categorías Rendimiento, Accesibilidad, Buenas prácticas y SEO.

| Perfil | Rendimiento | Accesibilidad | Buenas prácticas | SEO |
| --- | --- | --- | --- | --- |
| Móvil (Moto G Power simulado, 4G lento) | **95** | **100** | **100** | **100** |
| Escritorio | **100** | **100** | **100** | **100** |

| Métrica | Móvil | Escritorio |
| --- | --- | --- |
| First Contentful Paint | 0,9 s | 0,3 s |
| Largest Contentful Paint | 2,6 s | 0,6 s |
| Total Blocking Time | 150 ms | 40 ms |
| Cumulative Layout Shift | 0 | 0 |
| Speed Index | 0,9 s | 0,3 s |

**Resultado: cumple** (todas las categorías ≥ 90 en ambos perfiles).

Para repetirlo contra el despliegue real:

```bash
npx lighthouse@13.5.0 https://<dominio-de-produccion>/ --only-categories=performance,accessibility,best-practices,seo --view
```

```bash
npx lighthouse@13.5.0 https://<dominio-de-produccion>/ --preset=desktop --only-categories=performance,accessibility,best-practices,seo --view
```

## RIKDP-196 · Captura → veredicto en < 2 s

Prueba automatizada: `apps/web/e2e/capture-latency.spec.ts`.
- Con el modelo real (v0.9.0, 400×400) ya cargado, mide 10 veces desde el clic en «Inspeccionar» hasta que el veredicto aparece en pantalla.
- Usa la cámara simulada de Chromium.
- Criterio: percentil 95 < 2000 ms. La carga inicial del modelo no entra en esta métrica; es la de HU26.

| Backend | Muestras (ms) | Mediana | p95 |
| --- | --- | --- | --- |
| WebGL (emulado por software, sin GPU) | 1353, 932, 759, 843, 743, 811, 874, 859, 925, 875 | **874 ms** | **1353 ms** |

**Resultado: cumple.**
- El entorno de la medición no tiene GPU y emula WebGL por software. En un equipo de planta con GPU integrada el tiempo será menor.
- La primera muestra es la más lenta, porque compila los shaders.
- Falta confirmarlo en hardware real; se hace en la prueba manual con webcam física (RIKDP-191).

Para repetirla (desde `apps/web`, con la app compilada con `NEXT_PUBLIC_MODEL_MANIFEST_URL`):

```bash
E2E_MODEL_DIR=<carpeta con el manifest y el modelo> npx playwright test e2e/capture-latency.spec.ts
```
