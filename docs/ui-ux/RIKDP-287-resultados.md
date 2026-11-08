# RIKDP-287 · Inicialización y recuperación de TensorFlow.js

## Auditoría previa

Base: origin/main 6009e3d, rama feature/RIKDP-287-estados-carga-error-reintento-tfjs.
Árbol limpio al comenzar. Next 16.4.3, React 19, TypeScript, Tailwind 4,
TensorFlow.js 4.22, Vitest y Playwright; patrones visuales de RIKDP-274.

- RIKDP-155: lib/model/loader.ts consulta manifest, valida con manifest.ts,
  recupera IndexedDB, verifica hash opcional y recuerda versión para modo offline.
- RIKDP-156: preprocess.ts mantiene recorte y normalización existentes.
- RIKDP-157: loader.ts selecciona WebGL/WASM/CPU y hace calentamiento.
- Inspector ya muestra etapas/carga/listo/error y bloquea controles sin modelo.
- Faltan reintento sin recarga, distinción de errores recuperables, mensajes seguros,
  límites de espera y coordinación de inicializaciones. El modelo no se libera si
  falla el calentamiento, y se guarda como activo antes de comprobarlo.
- Existían pruebas de manifest/preproceso y E2E de carga/error, sin pruebas unitarias
  del cargador ni recuperación. Se amplían sin duplicar la lógica de inferencia.

Jira RIKDP-287 consultado: el alcance y los criterios coinciden con esta auditoría.
No se alteran pesos, umbral, preprocesamiento, autenticación ni contratos de API.

## Implementación y validación

Se documentarán los resultados ejecutados y las evidencias en esta sección.
