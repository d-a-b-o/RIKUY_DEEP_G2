# Registro de decisiones de arquitectura (ADR)

Cada decisión de arquitectura relevante se documenta en un archivo numerado con el formato de [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions): contexto, decisión y consecuencias.

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0001](0001-stack-tecnologico.md) | Stack tecnológico de la aplicación web | Aceptada |
| [0002](0002-inferencia-en-el-navegador.md) | Inferencia del modelo en el navegador con TensorFlow.js | Aceptada |
| [0003](0003-multiempresa-con-columna-company-id.md) | Multiempresa con base de datos compartida y columna `company_id` | Aceptada |
| [0004](0004-trazabilidad-inmutable.md) | Trazabilidad inmutable de inspecciones con eventos | Aceptada |
| [0005](0005-subida-directa-a-r2.md) | Subida de imágenes directa a R2 con URL prefirmada | Aceptada |
| [0006](0006-manifest-de-modelos.md) | Manifest de modelos para versionar y revertir sin desplegar | Aceptada |
| [0007](0007-estacion-de-inspeccion-automatica.md) | Estación de inspección automática en la línea de producción | Aceptada |

Los ADR 0001–0006 se aceptaron en la revisión de arquitectura del 2026-11-01 ([acta](../arquitectura/revisiones/2026-11-01-hu08.md)). El ADR 0007 se aceptó el mismo día al redefinir HU44 como inspección automática del 100 % de las piezas.

## Cómo escribir un ADR

1. Copia [plantilla.md](plantilla.md) como `NNNN-titulo-en-minusculas.md` con el siguiente número libre.
2. Rellena contexto, decisión, alternativas y consecuencias.
3. Añádelo a la tabla de arriba.
4. Un ADR aceptado no se edita: si la decisión cambia, se escribe uno nuevo que lo reemplaza y el antiguo pasa a **Reemplazada por NNNN**.
