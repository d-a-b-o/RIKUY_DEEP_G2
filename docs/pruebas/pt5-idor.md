# PT5 · Acceso a recursos de otra empresa (IDOR) — RIKDP-265

Objetivo: con una cuenta de la empresa B, ningún id de la empresa A permite leer ni modificar datos de A, ni por las pantallas ni por las Server Actions ni por las rutas de descarga.

## Cómo se prueba

| Capa | Archivo | Qué hace |
| --- | --- | --- |
| Servicios (integración con Postgres) | `apps/web/src/lib/security/idor.test.ts` | Crea dos empresas completas (catálogos, usuarios, invitación, inspección con foto, estación) y llama a cada función que recibe un id del navegador con cuentas de B (Inspector, Admin y Visualizador). |
| Pantallas y descargas (Playwright) | `apps/web/e2e/idor.spec.ts` | Inicia sesión como Admin de B y pide por URL el detalle de una inspección de A, el historial filtrado por lote y turno de A, y el reporte PDF/Excel de un turno de A. Una segunda prueba confirma que el dueño sí ve su inspección. |

Criterio de aprobación: la operación falla con `NOT_FOUND` (preferido: no revela que el id existe) o `FORBIDDEN`, y la fila de A queda igual.

## Puntos de entrada cubiertos

| Recurso | Operaciones probadas con ids de A |
| --- | --- |
| Inspecciones (HU24, HU40) | Detalle con URL de la foto, corrección de veredicto, registro en lote/turno de A, foto con clave de A, reutilizar el `clientId` de una inspección de A |
| Historial (HU42) | Listado sin filtros, filtrado por lote/turno/molde de A, opciones de los filtros |
| Dashboard y reporte (HU37, HU38) | KPIs y ranking de moldes, reporte de un turno de A (servicio y ruta `/panel/reportes/turno`) |
| Catálogos (HU31, HU33) | Editar/desactivar pieza, molde, lote y turno; eliminar lote; crear molde en pieza de A y lote con molde de A; listado |
| Usuarios (HU30) | Editar rol, desactivar, listado, revocar invitación |
| Estaciones (HU44) | Editar, reasignar lote, desactivar, guardar configuración, listado; una estación de B enviando inspecciones a un lote de A |
| Empresas (HU23) | Un Admin de planta no ve, edita, desactiva ni invita en ninguna empresa |

## Resultado (2026-11-22)

- 16 pruebas de servicio y 2 de Playwright en verde. **No se encontró ningún acceso cruzado.**
- Observación: con `cacheComponents` (streaming), la página de detalle de una inspección ajena muestra la vista 404 pero responde HTTP 200, porque `notFound()` ocurre después de enviar la cabecera. No expone datos. Las rutas de descarga sí responden 404.

## Mantenimiento

Si se agrega una pantalla, Server Action o ruta que recibe un id desde el navegador, se agrega su caso en `idor.test.ts`.
