# HU50-T04 · Dependabot (RIKDP-280)

## Revisión de controles existentes

No se encontró `dependabot.yml`, `dependabot.yaml` ni configuración de Renovate
en la rama de trabajo o en la referencia local `origin/main`. Jira contiene esta
subtarea y la tarea relacionada RIKDP-284: fijar actions por SHA. Esa tarea
consumirá las actualizaciones de Dependabot, pero no sustituye esta configuración.
`npm audit`, pip-audit y Dependency Review detectan vulnerabilidades; no realizan
la revisión periódica de versiones que configura este archivo.

## Configuración

`.github/dependabot.yml` programa revisiones **semanales, los lunes a las 09:00,
hora de Lima**. La hora es la programada por Dependabot, no una garantía de inicio
exacto. Cada ecosistema tiene un máximo de tres PR de actualización de versiones
abiertas simultáneamente:

| Ecosistema | Directorio | Archivos cubiertos |
| --- | --- | --- |
| npm | `/apps/web` | `package.json` y `package-lock.json`. |
| pip | `/ml` | Los cuatro `requirements-*.txt` de los entornos ML. |
| pip | `/.github` | `requirements-audit.txt`, para mantener también pip-audit. |
| GitHub Actions | `/` | `.github/workflows/*.yml` y actions de la raíz. |

GitHub Actions requiere `directory: /`, aunque los workflows estén dentro de
`.github/workflows`. No debe sustituirse por `/.github/workflows`.

Las actualizaciones **minor y patch** se agrupan por ecosistema para reducir PR.
Las major pueden crear PR individuales y requieren revisar compatibilidad;
no están bloqueadas por una regla `ignore`. Las PR se destinan a la rama por
defecto (`main`), conservan la revisión humana y los controles de CI existentes.
No se configura fusión automática ni se añaden secretos o permisos al workflow.

Los grupos usan `applies-to: version-updates`. No agrupan ni retrasan reparaciones
de seguridad hasta el lunes. Las actualizaciones de seguridad tienen su propio
funcionamiento y límites de GitHub, independientes del límite de tres PR de versiones.
La agrupación tampoco garantiza que toda ejecución cree una PR: si una versión
ya satisface un rango abierto, no necesariamente habrá un cambio de manifest.

## Activación pendiente en GitHub

El archivo debe llegar a **main** para que Dependabot empiece a usarlo. Mantenerlo
solo en la rama RIKDP-280 no activa las revisiones semanales del repositorio.

Un administrador debe comprobar en **Settings → Code security**:

1. **Dependency graph:** habilitado.
2. **Dependabot alerts:** habilitado (criterio de aceptación de RIKDP-280).
3. **Dependabot security updates:** habilitado para que GitHub proponga reparaciones
   automáticas cuando haya una actualización compatible disponible.

Las alertas y las PR de seguridad son funciones diferentes. `dependabot.yml`
configura actualizaciones, pero **no activa las alertas del repositorio**.
En esta entrega local no se modificó ni se confirmó el estado de esos ajustes.
La integración disponible en la revisión previa no tenía permisos de administración.

Después del merge, revisar **Insights → Dependency graph → Dependabot**, comprobar
que los tres ecosistemas se procesan y guardar evidencia del estado de las alertas.
También se puede iniciar una comprobación desde esa pantalla. Las alertas pueden
aparecer aunque no exista una versión corregida o una PR automática.

## Validación y revisión de PR

Se valida sintaxis YAML, estructura frente al esquema de Dependabot y existencia
de los manifests en las rutas configuradas. La ejecución real del servicio queda
pendiente del merge y de los ajustes del repositorio.

Revisar el resumen de cambios, compatibilidad y resultados de CI antes de fusionar
las PR de Dependabot. RIKDP-284 cubre fijar actions por SHA; esta entrega no cambia
sus referencias actuales. Si una dependencia ya estaba fijada por SHA, Dependabot
puede proponer actualizar esa referencia.

Referencias oficiales:
- [Opciones de Dependabot](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [Configurar actualizaciones de versiones](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates)
