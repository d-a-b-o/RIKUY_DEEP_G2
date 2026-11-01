# 0004 · Trazabilidad inmutable de inspecciones con eventos

- **Estado:** Propuesta
- **Fecha:** 2026-11-01
- **Tareas:** RIKDP-87 (HU07-T02), HU24, HU40

## Contexto

Cada inspección es evidencia de calidad: el cliente debe poder demostrar qué se inspeccionó, cuándo, por quién, con qué modelo y con qué resultado. Un inspector puede corregir un veredicto equivocado (HU40), pero la corrección no debe borrar el veredicto original, y las imágenes corregidas alimentan el reentrenamiento.

## Decisión

- La tabla `inspection` es **solo de inserción**: guarda el veredicto original del modelo y una instantánea del contexto (empresa, lote, turno, molde, pieza, inspector, versión del modelo, umbral).
- Cada cambio posterior es una fila nueva en **`inspection_event`**, también solo de inserción: `CREATED`, `CORRECTED` (con motivo obligatorio y veredicto nuevo) y `FLAGGED_FOR_RETRAINING`.
- El **veredicto vigente** es el del último evento `CORRECTED` o, si no hay ninguno, el original. Para que el dashboard no tenga que calcularlo en cada consulta, `inspection` puede guardar columnas derivadas (`current_verdict`, `corrected_at`), actualizadas en la misma transacción que el evento. Son las únicas columnas que se pueden modificar.
- La base de datos refuerza la regla: un trigger rechaza `DELETE` en ambas tablas y cualquier `UPDATE` de `inspection` que no toque solo las columnas derivadas. Se incluirá en la migración inicial (HU13).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Editar la fila de la inspección | Se pierde el veredicto original y no hay auditoría |
| Tabla de auditoría genérica (trigger que copia cambios) | Registra cambios técnicos, no eventos de negocio con motivo |
| Event sourcing completo | Desproporcionado para un MVP |

## Consecuencias

- Positivas: auditoría completa; correcciones trazables con autor y motivo; dataset de reentrenamiento directo (eventos `FLAGGED_FOR_RETRAINING`).
- Negativas o riesgos: las columnas derivadas deben mantenerse en la misma transacción que el evento; borrar datos por solicitud de un cliente (fin de contrato) requiere un procedimiento de plataforma que desactive el trigger de forma controlada.
