# PT5 · Caída simulada genera alerta en UptimeRobot — RIKDP-225

Objetivo: acreditar que, si un servicio vigilado deja de responder, el equipo **recibe una alerta real de caída (DOWN) y otra de recuperación (UP)**. No basta con el botón «Send test notifications» que ya se probó en HU43: esos correos llevan el prefijo `TEST` y no pasan por una comprobación fallida.

Para no tocar producción, la caída se simula con un **monitor temporal** que vigila un archivo controlado en el bucket de modelos. El archivo se borra para provocar la caída y se vuelve a subir para la recuperación. Los monitores reales (`804699929` web y `804699985` manifest) no se modifican.

## Requisitos

- Cuenta de UptimeRobot del equipo (la misma de HU43), con el contacto de correo verificado.
- Credenciales de escritura del bucket de modelos (`R2_*`), las mismas que usa `subir_a_r2.py`, o acceso al panel de R2 en Cloudflare.
- Unos 20 minutos, porque el plan gratuito comprueba cada 5 minutos.

## Procedimiento

1. **Crear el recurso vigilado.** Subir a R2, en el bucket de modelos, el archivo `exp/uptimerobot-caida-simulada.txt` con cualquier contenido, por ejemplo `ok`.
   ```bash
   curl -sI https://bucket.d-a-b-o.dev/exp/uptimerobot-caida-simulada.txt
   ```
   Debe responder `200`.
2. **Crear el monitor temporal** en UptimeRobot: *Add New Monitor*.
   - Tipo HTTP(s).
   - Nombre `RIKDP-225 caída simulada`.
   - URL `https://bucket.d-a-b-o.dev/exp/uptimerobot-caida-simulada.txt`.
   - Intervalo de 5 min, con el mismo contacto de correo que los monitores reales.
   - Esperar a que figure **Up**. Anotar el ID del monitor y la hora.
3. **Provocar la caída.** Borrar `exp/uptimerobot-caida-simulada.txt` del bucket. El `curl` anterior debe responder `404`. Anotar la hora.
4. **Esperar la alerta DOWN**, entre 5 y 10 min. Debe llegar un correo «Monitor is DOWN: RIKDP-225 caída simulada» **sin** el prefijo `TEST`. Anotar la hora de recepción.
5. **Recuperar.** Volver a subir el archivo del paso 1. Anotar la hora.
6. **Esperar la alerta UP**: correo «Monitor is UP», con la duración de la caída. Anotar la hora.
7. **Limpiar.** Pausar o borrar el monitor temporal y borrar el archivo de R2.

## Evidencia (completar)

| Dato | Valor |
| --- | --- |
| Fecha | |
| ID del monitor temporal | |
| Hora del borrado (caída) | |
| Hora del correo DOWN (sin «TEST») | |
| Hora de la nueva subida (recuperación) | |
| Hora del correo UP | |
| Tiempo de detección (correo DOWN − borrado) | |
| Monitor temporal pausado o borrado | Sí / No |

Adjuntar en Jira capturas de los dos correos, con la dirección del destinatario recortada, y del registro de eventos del monitor en UptimeRobot (*Latest events*).

**Criterio de aprobación:** llegan las dos alertas, sin el prefijo `TEST`, y la de caída llega en menos de 10 minutos.

## Por qué así

- No se apaga la web ni la base de datos, ni se cambia la configuración de Vercel: la demo y las estaciones no se ven afectadas.
- `exp/` es el prefijo de pruebas del bucket, aparte del modelo oficial (raíz) y del provisional (`dev/`). Borrar ese archivo no afecta a ningún modelo.
- El monitor temporal recorre el mismo camino que una caída real del manifest: comprobación HTTP fallida, incidente y correo.
