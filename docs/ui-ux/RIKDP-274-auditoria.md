# RIKDP-274 · Auditoría UI/UX

Fecha: 2026-11-02. Base: origin/main e9d67cc. Rama independiente de HU22.

## Inspección realizada

Se revisó el código Next.js 16.4.3/App Router, React 19, TypeScript y Tailwind 4,
README, AGENTS.md, identidad visual, tokens, componentes y pruebas existentes.
Se abrió la web publicada con Chromium de Edge mediante Playwright, sin iniciar
sesión ni enviar formularios de producción. Las cuatro rutas públicas devolvieron
HTTP 200; /panel redirigió a /ingresar?next=%2Fpanel. Capturas reales en
evidencias/RIKDP-274/antes-publicado-*.png (1280 px y landing a 360 px).

El navegador conectado no estaba disponible; se utilizó el navegador real de las
pruebas Playwright solicitadas. Node 16 local es incompatible: se preparó Node 22
portátil y un PostgreSQL de pruebas aislado, sin tocar datos de producción.

## Inventario y alcance

| Ruta | Implementación existente | Trabajo visual |
| --- | --- | --- |
| / | Hero, problemas, solución, pasos, comparación, planes, demo y footer | Jerarquía, navegación móvil, superficies y CTA |
| /ingresar | Better Auth, validación, redirección segura | Marco de acceso, campos y errores |
| /recuperar | Formulario de solicitud de enlace | Mismo marco y estados |
| /restablecer | Formulario y error de token | Mismo marco, enlaces y alertas |
| /panel | Bienvenida, rol, empresa, correo y enlace a inspección | Navegación lateral, encabezado y ficha de cuenta |
| /panel/inspeccion | Carga del modelo, archivo/cámara, preview y veredicto | Jerarquía operativa, controles y estados |

Las pantallas privadas se revisaron inicialmente en código; no se accedió a
cuentas de producción. Se validarán visualmente con cuentas ficticias locales.
No existen dashboards de métricas, tablas operativas, filtros ni modales: no se
crearán ni se mostrarán indicadores simulados. La tabla comparativa es pública.

## Hallazgos

- La landing publicada usa grandes superficies claras con acento naranja. No
  corresponde a la dirección oscura Industrial Tech aprobada para esta tarea.
- Las secciones repiten el mismo ritmo de títulos y grandes separaciones; falta
  distinguir introducción, beneficios, comparación y conversión visualmente.
- A 360 px desaparece la navegación de secciones; falta un acceso móvil equivalente.
- Los formularios de cuenta ocupan una tarjeta genérica centrada sin contexto visual.
- Panel e inspección comparten una cabecera horizontal pequeña, sin contexto de
  navegación activo. El panel no presenta métricas operativas reales.
- El estado OK/defectuosa combina fondos semánticos con texto blanco: al cambiar
  la paleta hay que comprobar el contraste del texto sobre cada estado.
- El selector archivo/cámara usa semántica de tabs sin navegación de flechas;
  conviene presentarlo como grupo de botones con estado presionado, conservando la acción.
- El input de archivo está oculto visualmente: su foco debe hacerse visible en
  la zona de carga. Inputs y botones necesitan bordes/foco distinguibles en oscuro.
- Ya existen etiquetas, aria-live, errores asociados y salto al contenido en la
  landing. Deben conservarse y extenderse a la navegación privada.

## Dirección y reutilización

Fondo #101827, superficies #253349, acciones cyan #22B8CF. Los colores de estado
se adaptarán para cumplir contraste AA con texto pequeño; los veredictos tendrán
icono y texto además de color. Se conserva el logo del ojo y el sistema de tokens
semánticos, Geist/Geist Mono y la ilustración SVG de la pieza fundida.

Se reutilizan Logo, InspectionPreview, AuthShell, Field/FormAlert, formularios,
PanelShell, Inspector y todos los datos/textos de las secciones. No cambian los
handlers, endpoints, Prisma, permisos, modelos, umbrales ni preprocesamiento.

## Plan

1. Tokens oscuros, superficies, botones/campos, foco y movimiento reducido.
2. Rediseño de hero/secciones y menú móvil accesible; formularios conservados.
3. Marco de cuenta y navegación privada; presentación del panel e inspección.
4. Pruebas existentes y responsive 360/768/1280; contraste, teclado y axe.
5. Capturas antes/después, informe de resultados y un PR abierto hacia main.

AGENTS.md solicita consultar las guías empaquetadas de Next. Durante la instalación
no estaba disponible node_modules/next/dist/docs; se consultaron también las guías
oficiales de CSS, layouts y Link. Tras completar npm ci se leyeron también
dist/docs/01-app/01-getting-started/11-css.md, 03-layouts-and-pages.md y la
referencia de Link empaquetada. La implementación mantiene las APIs existentes.
