# RIKDP-289 · Resultados de auditoría documental HU35

Fecha: **2026-11-09**. [Jira](https://dbravoo.atlassian.net/browse/RIKDP-289). Base auditada: `origin/main` = `98bbd550e2e694b418a02f93d61cffa764dee41b`. Rama independiente: `feature/RIKDP-289-documentacion-inferencia`. Alcance exclusivamente documental, sin cambios funcionales, migraciones, despliegues ni merge.

## Estado inicial y protección de trabajo

- Rama inicial: `feature/RIKDP-288-validacion-webcam-permisos`; sólo `?? output/` sin seguimiento (documentos previos), conservado íntegramente. Sin cambios versionados ni MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD o directorios de rebase pendientes.
- `git status` inicial detectó propietario distinto en sandbox. La lectura se realizó con `git -c safe.directory=D:/Documentos/Proyecto/RIKUY_DEEP_G2`; no se cambió la configuración global. Fetch y creación de rama se realizaron con aprobación del entorno, sin eludir restricciones.
- `git fetch origin` actualizó main de `6009e3d` a `98bbd55`. Rama creada con `git switch -c feature/RIKDP-289-documentacion-inferencia origin/main`; HEAD y merge-base coincidieron con ese commit. La rama no existía localmente.
- PR [#45](https://github.com/d-a-b-o/RIKUY_DEEP_G2/pull/45): cerrado, merged=true, merge `dc9b824`. PR [#57](https://github.com/d-a-b-o/RIKUY_DEEP_G2/pull/57): abierto, merged=false, head `e0c15e5913b2b4fb5ce99b8db199e5a13fbc877f`. Consultados nuevamente mediante GitHub. No se importó código de #57.
- Jira RIKDP-289 estaba **En curso**. Se consultaron HU35, HU26, HU24, HU31 y RIKDP-187–194. No se modificaron otras tareas.

## Documentación y diagramas

Se conserva `docs/ui-ux/` como ubicación del informe solicitada y usada por RIKDP-274/287; el contenido de arquitectura está en `docs/arquitectura/` y la guía en `docs/pruebas/` para mantener convenciones.

| Documento | Contenido |
| --- | --- |
| [Arquitectura HU35](../arquitectura/inspeccion-manual-hu35.md) | Mapa de módulos, componentes, secuencia con alternativas, errores, seguridad y dependencias |
| [Contratos HU35](../arquitectura/inspeccion-manual-contratos.md) | Datos internos TF.js, firma R2, DTO real de registro, validaciones, respuestas y trazabilidad |
| [Guía de reproducción](../pruebas/hu35-reproduccion.md) | Entorno, nombres de variables, ejecución local, cámara física/simulada, diagnóstico y límites de persistencia |
| [Índice de arquitectura](../arquitectura/README.md) | Enlaces y advertencia de que el flujo general no está conectado en HU35 |
| [Inferencia en navegador](../arquitectura/inferencia-navegador.md) | Aclaración de resultado local y estado histórico de versión/métricas |

Dos diagramas Mermaid nuevos: componentes con fronteras navegador/servidor/R2/BD y secuencia manual con errores y bloque de integración pendiente. No se generaron capturas de producto ni se reutilizaron evidencias de otras actividades como nuevas. Los renders de diagramas son controles de documentación, no pruebas de la aplicación.

## Hallazgos y matriz de implementación

| Función | Main `98bbd55` | PR #57 | Pendiente / no verificado |
| --- | --- | --- | --- |
| Modelo, caché, fallback y reintento inicial | Implementados por HU26/#45 | No necesario para describir main | Rendimiento/precisión no certificados por esta tarea |
| Captura de fotograma y clasificación | Implementadas en Inspector | Mejora ciclo de cámara | Selector y JPG manual |
| Permisos básicos | Denegado vs error genérico | Mejora errores, primer frame, desconexión y reintento | Hardware físico Chrome/Edge |
| Veredicto obsoleto tras error | Riesgo en main | Limpieza desarrollada | Integrar/revisar #57 por separado |
| Lote/turno | Catálogos y servicio backend disponibles | No los conecta | RIKDP-193 |
| Foto R2 y registro manual | Contratos disponibles, no llamados desde Inspector | No los conecta | RIKDP-192/194 |
| JPG, cola y sincronización automática | HU44 implementado por #58 | No es HU35 | No trasladar garantías de estación al manual |
| Bucket real, despliegue y webcam física | No auditados | Evidencia previa no es ejecución nueva | Requieren validación autorizada de su entorno |

Referencias principales: [Inspector](../../apps/web/src/components/inspection/inspector.tsx), [página](../../apps/web/src/app/panel/inspeccion/page.tsx), [loader](../../apps/web/src/lib/model/loader.ts), [manifest](../../apps/web/src/lib/model/manifest.ts), [preprocess](../../apps/web/src/lib/model/preprocess.ts), [acciones](../../apps/web/src/app/panel/inspeccion/actions.ts), [schema](../../apps/web/src/lib/inspections/schema.ts), [servicio](../../apps/web/src/lib/inspections/service.ts), [R2](../../apps/web/src/lib/storage/r2.ts), [Prisma](../../apps/web/prisma/schema.prisma), [catálogos](../../apps/web/src/lib/catalogs/service.ts), [estación](../../apps/web/src/components/station/station-kiosk.tsx). Se comprobaron los símbolos y contratos leyendo estos módulos; no se dedujeron APIs a partir de nombres de historias.

## Verificaciones ejecutadas

1. Git: estado inicial, operaciones pendientes, fetch, rama, HEAD y merge-base verificados. Ningún archivo previo descartado; main no se modificó directamente.
2. Vitest 4.1.12, desde `apps/web`, con `DATABASE_URL` vacío para impedir conexiones de integración: `vitest run src/lib/model/manifest.test.ts src/lib/model/preprocess.test.ts src/lib/model/loader.test.ts src/lib/storage/r2.test.ts src/lib/storage/sigv4.test.ts src/lib/inspections/rules.test.ts`. **6 archivos aprobados, 101 pruebas aprobadas, 0 omitidas, 0 fallidas**, duración 3,90 s. Loader usa mocks; firma R2 usa pruebas locales, no bucket remoto.
3. Enlaces relativos nuevos: comprobación de existencia de destinos y anchors locales; resultado final en [validación](evidencias/RIKDP-289/validacion.json). Se excluyen enlaces externos de la comprobación de filesystem. Los enlaces a Jira y PR fueron consultados con conectores autorizados. No se afirma que todos los enlaces de todo el repositorio estén sanos.
4. Mermaid **10.9.5**: parser y render en Chromium de ambos diagramas nuevos. Primer intento detectó un separador `;` incompatible en texto de secuencia; se corrigió antes de la validación final.
5. Revisión de contratos: campos cotejados con Zod, tipos TS, reglas de servicio y Prisma; se documentaron diferencias `cpu`/enum, duración fraccionaria/entero, obligatoriedad de foto manual y turno explícito frente a resolución automática.
6. Escaneo heurístico de los documentos nuevos: patrones de claves privadas, tokens GitHub, access keys AWS y URI Postgres con credenciales; revisión manual del diff. Sólo nombres de variables, ninguna credencial ni URL firmada real. No es una certificación completa de seguridad del repositorio.
7. `git diff --check` y revisión de alcance documental al finalizar. No se ejecutaron build, migraciones, pruebas E2E, pruebas de BD, acceso real R2 ni webcam física: no cambió código ejecutable y esas ejecuciones no son necesarias para comprobar enlaces/contratos. La guía contiene instrucciones, no resultados inventados.

El JSON de evidencia registra conteos y resultados finales del validador; no contiene tokens, imágenes ni datos de cuentas. No se agregan dependencias al package.json ni lockfile por la herramienta de validación.

## Dependencias y riesgos

- HU26 (RIKDP-37) y HU24 (RIKDP-35): **Listo** en Jira, código disponible. HU31 (RIKDP-42): **En curso**, catálogos existentes. HU35 (RIKDP-46): **En curso**.
- 187/188/189: **Por hacer**, a pesar de cámara/guía/permisos básicos presentes. 190: **Listo** (simulada). 191: **Por hacer** (física). 192/193/194: **Por hacer**, integración manual incompleta. Los estados Jira no prueban integración completa.
- #57 permanece dependiente de revisión/integración por su flujo de cámara; no cubre persistencia ni selección de contexto. No se fusiona en esta actividad.
- Falta retener JPG/contexto para reintentos manuales. Fallo entre PUT y registro puede dejar foto huérfana; no hay limpieza manual transaccional con R2 implementada.
- Firma/HEAD no verifican contenido, tamaño o hash de bytes. El servidor acepta inferencia del cliente sin recalcular; versión registrada no garantiza umbral consistente. Ver detalles en contratos/seguridad.
- Sólo `WEBGL/WASM` en DTO persistido, CPU posible en loader; integración futura debe resolverlo sin falsear backend. No implementar cambios de esquema aquí.
- Metas de latencia y calidad necesitan hardware/dataset/medición específicos. Ninguna prueba unitaria valida rendimiento industrial ni cámara física.

## Conclusión técnica

HU35 dispone del tramo cámara → canvas → preprocesamiento → inferencia → resultado local. HU24 aporta firma de imágenes y registro transaccional, y HU31 aporta contexto de catálogos. **La conexión manual de esos tramos sigue pendiente**; HU44 tiene una integración separada. La documentación identifica los contratos reales y brechas sin implementar RIKDP-192/193/194 ni presentar arquitectura deseada como estado ejecutable.

Publicación y estado final se registran en el PR de esta rama y en el comentario de RIKDP-289; la tarea sólo debe pasar a En revisión después de publicar el PR, nunca a Listo automáticamente.
