# SBOM web · Corrección RIKDP-241

## Por qué fallaba

`npm sbom` rechazaba el árbol con ESBOMPROBLEMS porque eslint-plugin-import 2.32.0,
eslint-plugin-jsx-a11y 6.10.2 y eslint-plugin-react 7.37.5 todavía declaran rangos
peer limitados a ESLint 9. El proyecto utiliza ESLint 10.14.0 y sus comprobaciones
de lint y pruebas se ejecutan con esa versión. ESLint 9 ya no tiene soporte:
esta corrección conserva ESLint 10 y las versiones realmente resueltas del proyecto.
No demuestra ni declara compatibilidad upstream donde todavía no existe.

## Generación y validación

Desde `apps/web`:

```sh
npm ci --ignore-scripts --legacy-peer-deps=false
npm run sbom
```

Se generan `sbom-web.cdx.json` y `sbom-web.cdx.json.compatibility.json`.
Para escribir en otra ubicación: `npm run sbom -- /ruta/sbom-web.cdx.json`.
El segundo archivo incluye SHA-256 del lockfile, declaraciones peer revisadas,
diagnósticos originales del generador y cobertura del inventario.

El script usa el generador oficial `@cyclonedx/cyclonedx-npm`, declarado en las
devDependencies y mantenido por Dependabot. El resultado es CycloneDX 1.6 JSON,
validado contra su esquema con Ajv y sus plugins de formatos.

Antes de tolerar un error de npm, el script inspecciona `npm ls` con resolución de
peer dependencies habilitada. Solo se admiten las declaraciones concretas de los
tres plugins citados, sus versiones y rangos actuales, frente a ESLint major 10.
Cambiar cualquiera de esas declaraciones exige revisión. Cualquier dependencia
faltante, otro paquete inválido o fallo no reconocido detiene la generación.
Únicamente después de ese control se usa `--ignore-npm-errors` del generador.
Los avisos no se pierden: se publican junto al SBOM, y el inventario no sustituye
las pruebas de compatibilidad ni las auditorías de seguridad.

Se comprueba que cada identidad nombre/versión del lockfile esté representada:
producción, desarrollo, peer, opcionales de todas las plataformas y aliases npm.
No se usa `--omit=dev` ni `--legacy-peer-deps=true` para evitar el error; ambas
opciones reducirían la cobertura esperada. Las versiones del inventario se leen
del lockfile, no se reemplazan por versiones prefijadas en el script.
El archivo final solo se publica después de superar esquema y cobertura.

## Cuándo se ejecuta

- CI valida la misma generación en cada PR que afecte a web, después de instalar
  dependencias. Así, una actualización futura no rompe el SBOM solo después del merge.
- El workflow `HU51 SBOM` conserva su contrato: tras CI exitoso por push a main,
  inventaría ese SHA y guarda ambos archivos web por 90 días. Se mantienen también
  los cuatro inventarios ML, sin cambios.
- Las ejecuciones de HU51 SBOM disparadas por CI de PR siguen apareciendo omitidas
  por diseño; el paso de validación de SBOM del job web sí se ejecuta en la PR.

Las pruebas del script rechazan dependencias omitidas y errores no aprobados,
además de cubrir aliases y paquetes opcionales/peer. La generación completa se
verifica también con npm 10.9.9, la versión observada en Actions.

Referencias: [generador oficial CycloneDX](https://github.com/CycloneDX/cyclonedx-node-npm),
[soporte ESLint](https://eslint.org/version-support),
[npm sbom](https://docs.npmjs.com/cli/v10/commands/npm-sbom/).
