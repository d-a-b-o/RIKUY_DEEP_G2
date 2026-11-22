# UAT · Guion y datos de la demo piloto (HU49-T01, RIKDP-244)

Prueba de aceptación con un usuario externo, alguien del área de calidad de una planta de fundición. Valida que el MVP le sirve para su trabajo diario, no solo que funciona técnicamente. Este guion lo usan el facilitador y el observador; el acta va en [uat-acta.md](uat-acta.md).

## 1. Preparación (el día anterior)

| Paso | Responsable | Cómo |
| --- | --- | --- |
| Entorno | Facilitador | Preview de Vercel de `main` (o producción, si se usa una empresa de prueba). Anotar la URL y el commit. |
| Datos | Facilitador | Desde `apps/web`: `DIRECT_URL="<cadena directa del entorno>" npm run demo:uat`. Pide escribir «SI» y una contraseña para las 4 cuentas. Con `-- --fotos <carpeta de JPG>` y las variables `R2_*`, sube fotos reales para las piezas defectuosas del histórico. |
| Modelo | Facilitador | El script registra la versión del modelo (por defecto `1.0.0`). Debe coincidir con la `activeVersion` del manifest del entorno: `-- --modelo 0.9.0 --umbral 0.2437`, si fuera el caso. |
| Cámara | Facilitador | Equipo con webcam, Chrome o Edge actualizado, y una pieza (o foto impresa) bien iluminada. |
| Estación | Facilitador | Segundo equipo o ventana privada con la cuenta `estacion@…`, para el escenario 5. |
| Grabación | Observador | Pedir permiso al usuario para grabar la pantalla y tomar notas. |

### Cuentas que crea el script

| Cuenta | Rol | Para qué |
| --- | --- | --- |
| `admin@uat.rikuydeep.test` | Admin de planta | Catálogos, usuarios, estaciones, reportes |
| `inspector@uat.rikuydeep.test` | Inspector | Inspección y corrección de veredictos |
| `consulta@uat.rikuydeep.test` | Visualizador | Dashboard, historial y reportes (solo lectura) |
| `estacion@uat.rikuydeep.test` | Estación | Pantalla de la estación automática |

Datos: empresa «Planta piloto RikuyDeep (UAT)», pieza IMP-150 con moldes M-12 y M-13, turnos Mañana, Tarde y Noche, lote L-UAT-01 (cerrado) y L-UAT-02 (abierto), y la estación «Línea 1 · Estación 1» asignada a L-UAT-02. Incluye además unos 7 días de histórico (~650 inspecciones, ~5 % defectuosas, 2 corregidas). Si se vuelve a ejecutar, el script no duplica datos.

## 2. Desarrollo de la sesión (60–75 min)

1. **Bienvenida (5 min):** objetivo, que se prueba el sistema y no a la persona, pensar en voz alta y que no hay respuestas incorrectas.
2. **Escenarios (45–55 min):** el usuario los hace solo, leyendo la tarjeta del escenario. El facilitador solo interviene si el usuario se bloquea más de 2 minutos; eso se anota como hallazgo.
3. **Cierre (10 min):** preguntas de la sección 4 y firma del acta.

## 3. Escenarios

Para cada escenario el observador marca **Aprobado / Con observaciones / Fallido**, el tiempo y las citas textuales.

| # | Rol | Tarea que se le da al usuario | Criterio de aceptación | HU |
| --- | --- | --- | --- | --- |
| 1 | Admin | «Entra al sistema con tu cuenta.» | Inicia sesión sin ayuda. Si la empresa exige 2FA, la configura con su app. | HU19, HU29 |
| 2 | Admin | «Revisa que la pieza, los moldes y los turnos de tu planta estén bien y abre un lote nuevo, L-UAT-03, en el molde M-13.» | Encuentra Catálogos, entiende el turno activo y crea el lote. | HU31, HU33 |
| 3 | Admin | «Invita a un compañero como Inspector.» | Llega al enlace de invitación (o lo copia si el correo no está configurado). | HU30 |
| 4 | Admin | «Asigna el lote L-UAT-03 a la estación de la Línea 1.» | Lo hace desde Estaciones y entiende que la estación lo toma sola. | HU44 |
| 5 | Estación | «Inicia la estación al comienzo del turno y pasa 5 piezas por la cámara, una por una.» | Calibra con la cinta vacía, cuenta cada pieza una sola vez y, ante una defectuosa, la alerta a pantalla completa se detiene con «Pieza retirada». | HU44 |
| 6 | Estación | «Desconecta el wifi, pasa 2 piezas más y vuelve a conectar.» | Sigue inspeccionando sin red. «Por enviar» sube y vuelve a 0 al reconectar. | HU44 |
| 7 | Inspector | «Inspecciona una pieza con la cámara de tu equipo.» | Obtiene el veredicto en pocos segundos y entiende la confianza. | HU26, HU35 |
| 8 | Inspector | «En el historial, busca una pieza defectuosa de ayer en el turno Noche y corrige el veredicto si crees que el modelo se equivocó.» | Filtra, abre el detalle con foto y trazabilidad, y corrige con un motivo. El evento queda en la historia. | HU40, HU42 |
| 9 | Visualizador | «¿Qué turno tuvo más defectos esta semana y en qué molde?» | Lo responde desde el Dashboard sin ayuda. | HU37 |
| 10 | Visualizador | «Descarga el reporte del turno Tarde de ayer en PDF y en Excel.» | Descarga los dos y confirma que tienen las mismas cifras. | HU38 |
| 11 | Visualizador | «Intenta corregir un veredicto o entrar a Usuarios.» | No ve esas opciones; si escribe la URL, ve el aviso de acceso denegado. | HU32 |

> El escenario 7 depende de que la inspección manual guarde el registro (HU35). Si en la fecha de la UAT todavía no lo hace, se ejecuta solo como clasificación y se anota como limitación conocida, no como hallazgo.

## 4. Preguntas de cierre

1. Del 1 al 5, ¿qué tan fácil fue? ¿Qué fue lo más difícil?
2. ¿Usarías la estación automática en tu línea? ¿Qué te haría desconfiar del veredicto?
3. ¿El dashboard y el reporte te sirven para la reunión de fin de turno? ¿Qué falta?
4. ¿Qué cambiarías primero?

## 5. Clasificación de hallazgos (triage, HU49-T03)

| Severidad | Definición | Acción antes del cierre |
| --- | --- | --- |
| Crítica | Impide completar un escenario o pierde o expone datos | Corregir (HU49-T04) y repetir el escenario |
| Alta | Se completa con ayuda o con un error visible | Corregir si cabe en el sprint; si no, documentar |
| Media | Confunde, pero el usuario lo resuelve solo | Backlog |
| Baja | Cosmético o una sugerencia | Backlog |

## 6. Después de la sesión

- Pasar los hallazgos a Jira con la etiqueta `uat` y su severidad.
- Completar y firmar [uat-acta.md](uat-acta.md).
- Si se usó producción, desactivar las cuentas `@uat.rikuydeep.test` y la estación.
