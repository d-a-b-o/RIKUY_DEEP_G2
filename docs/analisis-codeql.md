# HU50-T01 · CodeQL (RIKDP-277)

## Automatización

`.github/workflows/ci.yml` invoca el workflow reutilizable `codeql.yml` en cada
pull request (cualquier rama destino), push a `main` y ejecución manual de CI.
No hay filtros de rutas: siempre se analizan `javascript-typescript` y `python`,
en jobs independientes, con CodeQL v4 y consultas `security-extended`.
Ambos lenguajes usan `build-mode: none`: no requieren instalar las dependencias
de la aplicación, levantar PostgreSQL, descargar datasets ni entrenar modelos.
CodeQL analiza los archivos fuente compatibles; no se presupone cobertura de
las celdas de los notebooks `.ipynb`. El código Python extraído en `ml/` sí se analiza.

Los resultados se publican con el `GITHUB_TOKEN` automático en
**Security → Code scanning**, separados por lenguaje, y se conservan como
artefactos SARIF durante 14 días en Actions. No se necesita un PAT ni agregar secretos.

## Política de bloqueo

Tras el análisis, `check_codeql.py` inspecciona los SARIF generados y falla con
cualquier resultado cuya regla tenga `security-severity >= 7.0` (alta o crítica).
Se usa el puntaje de seguridad de la regla, no `level: warning/error` de SARIF.
También falla si faltan reportes o los datos necesarios son inválidos.
La política abarca todos los hallazgos emitidos, incluso los preexistentes;
no descuenta alertas desestimadas en la interfaz de GitHub.

El job final **CI** depende de CodeQL: un fallo de cualquiera de los lenguajes
produce un fallo de CI. Para impedir la fusión, **CI debe ser un check obligatorio
en la protección o ruleset de `main`**. Un workflow por sí solo no impide que un
usuario con permisos de omisión fusione una PR.

## Configuración inicial en GitHub

1. En **Settings → Code security**, verificar que CodeQL use **Advanced setup**.
   Si está activo Default setup, desactivarlo antes de usar este workflow.
2. Habilitar GitHub Actions y permitir las acciones oficiales utilizadas.
   Code scanning está disponible en repositorios públicos; en privados requiere
   acceso a GitHub Code Security. Los permisos del repositorio/organización deben
   permitir que el workflow publique `security-events`.
3. En **Settings → Rules → Rulesets** o **Branches**, comprobar que la regla
   activa para `main` exija pull request y el check **CI** antes de fusionar.
   Conservar las demás protecciones. Esta configuración no se aplica desde YAML.
4. Abrir una PR desde `RIKDP-277-hu50-t01-analisis-estatico-de-seguridad-con-code`
   hacia `main`: se ejecutarán los dos análisis automáticamente.
5. Revisar Actions → CI → Seguridad estática, los dos artefactos SARIF y
   Security → Code scanning. Después del merge, el push a `main` genera su baseline.

## Validación y evidencia

Ejecutar desde la raíz:

```sh
python -m unittest discover -s .github/scripts/tests -v
```

Las pruebas usan reportes sintéticos: verifican el límite 7.0, severidad crítica,
resultados medios/bajos, múltiples reportes y rechazo de reportes ausentes o
inválidos. No agregan vulnerabilidades intencionales a la aplicación.
La ejecución real de CodeQL y la publicación SARIF requieren GitHub Actions;
las pruebas locales de la política no sustituyen esa evidencia.

Para cerrar RIKDP-277, adjuntar la URL de la ejecución real, los dos análisis,
la evidencia de bloqueo alto/crítico y la protección de `main` con CI obligatorio.

Referencias oficiales:
- [Advanced setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning)
- [Severidad de seguridad en SARIF](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support)
- [CodeQL Action v4](https://github.com/github/codeql-action)
