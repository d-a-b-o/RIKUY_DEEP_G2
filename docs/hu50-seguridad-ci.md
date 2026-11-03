# HU50-T05 · Controles de seguridad y atención de hallazgos (RIKDP-281)

## Un único check obligatorio

El workflow `.github/workflows/ci.yml` termina con el job **CI**, que depende de
`changes`, `web`, `ml`, `convenciones`, `archivos`, `dependencias`, `codeql` y
`gitleaks`. CodeQL y Gitleaks ya estaban integrados; pip-audit cuenta mediante ML.
Esta tarea refuerza la comprobación de sus resultados, sin duplicar escáneres.

`CI` usa `if: always()` para evaluar los resultados incluso cuando otro job falla.
`check_ci.py` exige éxito de CodeQL, Gitleaks y detección de cambios; rechaza
fallos, cancelaciones, estados desconocidos, jobs ausentes y filtros inválidos.
Cuando el filtro de ML es `true`, **ML debe terminar correctamente**, incluyendo
pip-audit. Lo mismo se exige a Web cuando su filtro es `true`.

Se permiten exclusivamente estas omisiones:

- Web o ML sin cambios en sus rutas, conforme a los filtros de CI.
- Convenciones en PR de bots o sin cambios Web/ML; fuera de PR tampoco se ejecuta.
- Archivos grandes y Dependency Review fuera de PR.

Una ejecución manual exige Web y ML, además de CodeQL y Gitleaks. Una PR de solo
documentación sigue pasando por CodeQL y Gitleaks. Un workflow cancelado completo
o que no llega a arrancar no aporta una aprobación de CI para el nuevo commit.
`HU22 model regression` es un workflow separado: esta tarea no lo integra en CI.

Un administrador debe configurar la protección/ruleset de `main` para exigir
**CI** como único check obligatorio, ligado a GitHub Actions y al commit vigente.
No marcar los jobs con filtros como obligatorios por separado. Conservar las
demás protecciones existentes. No habilitar omisiones para sortear un hallazgo.
El YAML no configura la protección de ramas; su estado remoto no se verificó ni
modificó en esta entrega local. Sin esa protección, un CI rojo no garantiza que
GitHub impida fusionar. Si se adopta merge queue, habrá que añadir `merge_group`
y adaptar el contrato y los workflows antes de usarla.

## Qué revisa cada control

| Control | Alcance y bloqueo | Dónde revisar |
| --- | --- | --- |
| CodeQL | JavaScript/TypeScript y Python en cada PR, push a main o ejecución manual. Cualquier hallazgo emitido con `security-severity >= 7.0` bloquea, aunque ya existiera. También bloquea un reporte inválido o ausente. | Security → Code scanning; artefactos `codeql-javascript-typescript` y `codeql-python`, 14 días. |
| Gitleaks | Commits de la PR; historial alcanzable en main/manual. Cualquier secreto no exceptuado bloquea. | Paso Gitleaks y `gitleaks-report`, 7 días, valores ocultos. |
| pip-audit | Todos los `ml/requirements-*.txt`, separados, con transitivas cuando se ejecuta ML. Severidad high/critical bloquea; low/moderate se informa. Una auditoría incompleta también bloquea. | Paso de auditoría en ML; `pip-audit-reports`, 14 días, especialmente `summary.json`. |
| npm audit | Dependencias de producción cuando se ejecuta Web; umbral high. | Log de auditoría del job Web. |
| Dependency Review | Dependencias modificadas en la PR; umbral high. | Job Revisión de dependencias y resumen de la PR si falla. |
| Dependabot | Propuestas de actualización y alertas; no es un escáner adicional ejecutado por CI. Sus PR pasan por los controles anteriores según las rutas. | Security → Dependabot; PR del bot. Activación de alertas requiere configuración remota. |

Los errores de red, instalación, resolución, API, permisos o archivos ausentes no
son falsos positivos de seguridad. Se corrigen y se repite la ejecución. No se
convierten en un resultado verde usando `continue-on-error`, quitando un `needs`
o cambiando un umbral. CodeQL no asegura cobertura de las celdas `.ipynb`.

## Cómo leer y corregir un hallazgo

1. Abrir el CI del **commit de la PR** y localizar el primer job/paso fallido.
   El fallo del job final CI resume resultados; la causa está en el control.
2. Leer el reporte: regla o CVE/GHSA, severidad, ruta y línea o paquete/versión,
   versión corregida disponible, alcance y URL del aviso. Varias entradas pueden
   ser alias o repeticiones del mismo aviso: comprobar su identidad antes de
   contar vulnerabilidades diferentes.
3. Registrar en Jira un Error vinculado a HU50 y la PR: identificador, impacto,
   responsable, evidencia y acción propuesta. La severidad S1–S4 de defectos del
   plan de pruebas no sustituye la severidad CVSS/high/critical del escáner.
4. Para CodeQL, revisar entrada de datos, flujo y contexto; corregir el código.
   Para dependencias, identificar si son directas o transitivas y actualizar el
   paquete que corresponda, respetando compatibilidad. No forzar versiones
   incompatibles ni suprimir una biblioteca funcional sin validar su uso.
5. Para secretos reales, **revocar/rotar antes de cerrar**: actualizar consumidores,
   comprobar que la credencial anterior ya no funciona y retirar el valor del
   código. Borrarlo del último commit no lo elimina del historial. Coordinar por
   separado una eventual reescritura del historial.
6. Ejecutar de nuevo los controles y las pruebas afectadas. Guardar el enlace a
   la ejecución correcta y al commit de corrección. No cerrar con evidencia de
   otro commit ni solo con una prueba simulada del script.

No copiar credenciales reales a Jira, PR, capturas o documentos públicos. Usar
identificadores y evidencia redactada; avisar al propietario por un canal autorizado.

## Falsos positivos: propuesta, decisión y efecto

El autor propone la clasificación; **no la aprueba por sí mismo**. Andre Chumbiraico,
responsable de HU50, coordina el análisis técnico con el responsable del componente.
Daniel Sánchez revisa dependencias y entornos ML y es responsable de PT5/RIKDP-243.
David Bravo (PO) resuelve la aceptación y prioridad de riesgos. Si Andre es autor,
Daniel o David debe realizar la revisión independiente. El administrador del
repositorio aplica las decisiones que requieren permisos sobre alertas.

Toda excepción debe quedar aprobada **antes del merge** por un revisor distinto
del autor y registrada en Jira y en la PR. Esto no cambia la política general de
revisión de otras PR: es un requisito para las excepciones de seguridad.

Registrar: control e ID, commit, ruta/paquete y versión, evidencia técnica de por
qué no aplica, alcance mínimo, proponente, revisor y aprobación, fecha y condición
de revalidación. Aceptar un riesgo real no lo convierte en falso positivo ni
autoriza saltarse CI. Si no hay evidencia suficiente, se mantiene abierto.

| Control | Cómo marcar y limitar una excepción |
| --- | --- |
| Gitleaks | Proponer en `.gitleaksignore` exclusivamente la huella `commit:archivo:regla:línea`, con motivo y referencia a la revisión. La entrada sí afecta al escáner. No excluir archivos/carpetas ni usarla para secretos reales. Las dos entradas históricas existentes deben conservar su evidencia de aprobación; un comentario de «propuesta» no es aprobación. |
| CodeQL | Registrar la propuesta en Jira/PR y, con permisos, marcar la alerta en Security → Code scanning como **False positive**, con justificación. Esa acción solo cambia la clasificación en GitHub: el script local sigue evaluando SARIF y **no descuenta alertas desestimadas**. Si vuelve a emitir el hallazgo, corregir el patrón o proponer un ajuste focalizado y revisado del análisis; no desactivar una regla global para conseguir verde. |
| pip-audit / npm audit | Registrar la propuesta con el aviso y el árbol/contexto de dependencias. Estos controles no tienen una lista de exclusiones propia configurada en este repositorio. Aprobar una clasificación en Jira no cambia su resultado: corregir la dependencia o presentar por separado una excepción técnica mínima, versionada, probada y aprobada. No añadir `--ignore-vuln` ni retirar el paquete sin revisión. |
| Dependabot | Un administrador o colaborador autorizado puede desestimar una alerta indicando el motivo técnico y la revisión. Esto no elimina el aviso de pip-audit/npm audit ni aprueba CI. |

Revalidar una excepción al cambiar el archivo, versión, uso o aviso; eliminarla
si deja de aplicar. Una rotación real se documenta sin publicar el valor antiguo
ni el nuevo. Las guías de detalle están en [Gitleaks](hu50-gitleaks.md),
[pip-audit](hu50-pip-audit.md), [CodeQL](analisis-codeql.md) y
[Dependabot](hu50-dependabot.md).

## Verificación y cierre

Ejecutar desde la raíz:

```sh
python -m unittest discover -s .github/scripts/tests -v
```

Las pruebas locales verifican el contrato del job puerta y las políticas de
severidad con datos sintéticos. Los escenarios completos y evidencia requerida
están en el [plan de pruebas, HU50 / RIKDP-243](pruebas/plan-de-pruebas.md#hu50--seguridad-y-job-puerta-ci-rikdp-281--rikdp-243).
Antes de cerrar, adjuntar ejecución real, estado de protección de main y revisión
de excepciones. La actualización de RIKDP-243 en Jira y su ejecución formal por
Daniel siguen pendientes: esta entrega actualiza su procedimiento en el repositorio.

Referencias oficiales: [Jobs dependientes y always()](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[checks obligatorios](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
