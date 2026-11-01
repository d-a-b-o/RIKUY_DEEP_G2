# 0005 · Subida de imágenes directa a R2 con URL prefirmada

- **Estado:** Propuesta
- **Fecha:** 2026-11-01
- **Tareas:** RIKDP-86 (HU07-T01), HU24, HU35, HU39

## Contexto

Cada inspección guarda la imagen original en R2. Las imágenes pueden pesar hasta 5 MB (HU39), y en modo lote o video se suben muchas seguidas. Las funciones de Vercel tienen un límite de tamaño de cuerpo de la petición y cobran por tiempo de ejecución.

## Decisión

1. El navegador pide al servidor una **URL prefirmada de subida** (PUT) mediante una Server Action que verifica sesión, rol y empresa.
2. El servidor genera la clave del objeto: `companies/{company_id}/inspections/{yyyy}/{mm}/{uuid}.jpg`. El cliente no elige la ruta.
3. El navegador sube la imagen **directamente a R2**.
4. Después registra la inspección con la clave. El servidor comprueba que el objeto existe y pertenece a la empresa antes de insertar.
5. Para ver una imagen, el servidor genera una **URL prefirmada de lectura** de corta duración.
6. Mientras no se confirme el registro, la captura se conserva en IndexedDB y se reintenta (HU35).

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Subir la imagen a través de una Server Action | Límite de tamaño de cuerpo en Vercel y coste de ejecución por cada imagen |
| Bucket público | Las imágenes son datos de producción del cliente |

## Consecuencias

- Positivas: sin límite de tamaño de Vercel; menos coste; el bucket permanece privado.
- Negativas o riesgos:
  - Pueden quedar objetos huérfanos si la subida termina pero el registro falla definitivamente. Se mitiga con una regla de ciclo de vida o una limpieza periódica de objetos sin inspección.
  - Hay que configurar CORS en el bucket para el dominio de la app.
