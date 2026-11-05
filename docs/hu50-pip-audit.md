# HU50-T03 · Auditoría Python (RIKDP-279)

## Comportamiento de CI

El job ML de `.github/workflows/ci.yml` ejecuta `audit_python.py` antes de instalar
las dependencias de pruebas. Usa pip-audit 2.10.1 en un entorno virtual separado,
definido en `.github/requirements-audit.txt`.

Se descubren todos los `ml/requirements-*.txt` y se auditan **por separado** para
no mezclar los entornos de CI, publicación, entrenamiento y regresión. Se mantiene
la resolución normal de pip-audit, incluyendo dependencias transitivas: no se
usan `--no-deps`, `--disable-pip` ni listas de vulnerabilidades ignoradas.
Resolver requirements puede descargar paquetes y procesar metadatos de builds;
no se ejecutan modelos ni entrenamiento como parte de la auditoría.

El job se activa con los mismos eventos y filtros de ML existentes: cambios en
`ml/**`, el notebook principal, CI o los archivos de esta auditoría; también en
ejecuciones manuales. Conserva lint y pytest. El job final CI ya depende de ML y
propaga su fallo. Se amplió el tiempo del job a 30 minutos para la resolución.

## Umbral de severidad

pip-audit devuelve salida 1 ante cualquier vulnerabilidad y su JSON no incorpora
severidad. Por eso el script consulta la API pública de GitHub Advisory Database:
usa los alias GHSA y, si no encuentra avisos GHSA, busca por CVE. Reutiliza las
consultas dentro de la ejecución. En Actions usa el GITHUB_TOKEN automático para
evitar el límite reducido de consultas anónimas; no hace falta crear un PAT.

| Resultado | Decisión |
| --- | --- |
| Sin vulnerabilidades | Aprueba. |
| Solo low o moderate/medium | Reporta y aprueba. |
| Algún high o critical | Falla, como `npm audit --audit-level=high`. |
| Sin severidad verificable, aviso retirado o error de API | Falla por auditoría incompleta; requiere revisión. |
| Resolución fallida, dependencia omitida, JSON ausente/inválido o timeout | Falla por auditoría incompleta. |

Si existen varios avisos, se aplica la mayor severidad. No se convierte un dato
desconocido en severidad baja. Los errores operativos se distinguen en el resumen
de los hallazgos altos/críticos; también bloquean para evitar aprobar sin análisis.

## Reportes y correcciones

Actions conserva durante 14 días el artefacto `pip-audit-reports` con:

- Un JSON original de pip-audit por archivo de requirements.
- `summary.json`: paquete, versión resuelta, identificadores, severidad, versiones
  corregidas disponibles, decisión de bloqueo y errores por archivo.

Revisar `summary.json` y los logs del paso. Ante un hallazgo alto/crítico, actualizar
la dependencia directa o la que introduce la transitiva, comprobar compatibilidad
y repetir auditoría y pruebas. No se actualizan dependencias automáticamente.
Ante un error operativo, resolver conectividad, compatibilidad de Python o datos
faltantes antes de repetir. Esta entrega no agrega excepciones de vulnerabilidades.

## Verificación local

Pruebas sin red, desde la raíz:

```sh
python -m unittest discover -s .github/scripts/tests -p test_audit_python.py -v
```

Para auditar realmente, instalar `.github/requirements-audit.txt` en un entorno
virtual separado y, usando su Python, ejecutar desde la raíz:

```sh
python .github/scripts/audit_python.py --requirements-dir ml --output reports/pip-audit
```

`reports/` está ignorado por Git. Se necesita acceso a PyPI y api.github.com;
GITHUB_TOKEN es opcional localmente y debe configurarse por entorno sin guardarlo
en archivos. Usar Linux/Python 3.13, como CI, para obtener la misma resolución.
Los rangos abiertos de requirements se resuelven al ejecutar; los resultados
pueden cambiar con nuevas versiones y avisos. La auditoría de archivos no asegura
que un entorno histórico de Colab tenga instaladas esas mismas versiones.

Las pruebas cubren umbral, alias GHSA/CVE, datos desconocidos, dependencias
omitidas, fallos de API, todos los requirements separados, transitivas, salida
inconsistente y rechazo de reportes antiguos. La ejecución real en GitHub Actions
queda pendiente de subir estos cambios; no se afirma que las dependencias estén
libres de vulnerabilidades por haber aprobado las pruebas simuladas.

Validación local realizada el 2026-11-03:

- 12 pruebas automatizadas aprobadas y sintaxis YAML verificada.
- pip-audit 2.10.1 y consultas reales a GitHub: una muestra aislada con
  `requests==2.31.0` produjo seis avisos moderados y salida 0.
- Otra muestra aislada con `PyJWT==1.7.1` produjo un aviso bajo, cuatro moderados,
  nueve altos y uno crítico; el script bloqueó con salida 1.
- Los archivos de muestra y sus reportes están únicamente en `reports/hu50/`,
  ignorado por Git. No se añadieron esas versiones a las dependencias del proyecto.
- No se ejecutó localmente la resolución completa de los cuatro entornos ML:
  su verificación en Linux/Python 3.13 queda pendiente en CI.

Referencias oficiales:
- [pip-audit: uso, JSON y códigos de salida](https://github.com/pypa/pip-audit/tree/v2.10.1)
- [GitHub Advisory Database REST API](https://docs.github.com/en/rest/security-advisories/global-advisories)
