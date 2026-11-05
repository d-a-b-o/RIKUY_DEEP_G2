# Identidad visual

Guía de la marca de RikuyDeep y de cómo usar los tokens de diseño en `apps/web`.

Tareas: RIKDP-90 (HU08-T01 · logo, favicon y paleta) y RIKDP-91 (HU08-T02 · tokens de diseño en Tailwind).

## Logo

<p>
  <img src="../apps/web/public/brand/rikuydeep-mark.svg" alt="Marca de RikuyDeep" width="96">
  &nbsp;&nbsp;
  <img src="../apps/web/public/brand/rikuydeep-icon.svg" alt="Icono de RikuyDeep" width="96">
</p>

*Rikuy* significa «ver» en quechua. La marca es un ojo cuyo iris es una pieza fundida hexagonal: la inspección visual de piezas de fundición.

| Recurso | Archivo | Uso |
| --- | --- | --- |
| Marca | `apps/web/public/brand/rikuydeep-mark.svg` | Documentos, presentaciones y fondos claros |
| Icono | `apps/web/public/brand/rikuydeep-icon.svg` | Avatar, redes, cualquier fondo |
| Componente | `apps/web/src/components/brand/logo.tsx` | Dentro de la app: `<Logo />` (marca + nombre) y `<LogoMark />` (solo marca). Se adaptan al tema claro/oscuro |
| Favicon | `apps/web/src/app/favicon.ico` (16, 32 y 48 px) | Navegadores antiguos |
| Icono app | `apps/web/src/app/icon.svg` | Pestañas de navegadores modernos |
| Apple | `apps/web/src/app/apple-icon.png` (180 px) | Acceso directo en iOS |

El nombre se escribe **RikuyDeep**, en una sola palabra: «Rikuy» en el color de texto y «Deep» en el color de acento.

Para regenerar `favicon.ico` y `apple-icon.png` después de cambiar `icon.svg`, se renderiza el SVG con Playwright a 16, 32, 48 y 180 px y se empaqueta con Pillow. El icono de Apple usa la versión sin esquinas redondeadas, porque iOS aplica su propia máscara.

## Paleta

### Escalas de marca

| Escala | Rol | 50 | 300 | 500 | 600 | 700 | 900 | 950 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `acero` | Primario: estructura, confianza, industria | `#eef4f8` | `#74a2c3` | `#2a658f` | `#1f5075` | `#1a405e` | `#122a3d` | `#0b1b29` |
| `colada` | Acento: el metal fundido, llamadas a la acción | `#fff4ed` | `#ffa370` | `#f55a16` | `#e2550f` | `#c2410c` | `#792412` | `#410e07` |

Las escalas completas (50 a 950) están en `apps/web/src/app/globals.css` y se usan como cualquier color de Tailwind: `bg-acero-900`, `text-colada-700`.

### Tokens semánticos · Industrial Tech (RIKDP-274)

La interfaz ofrece modo claro y oscuro. La primera visita sigue la preferencia del
sistema; el selector de sol/luna conserva la elección en este navegador al navegar
y recargar. Si el almacenamiento está bloqueado, el cambio sigue funcionando en la
página actual. Se conservan el logo, Geist/Geist Mono y las escalas de marca originales.
Las acciones usan cyan y el acento naranja identifica la marca.

El modo claro usa fondo #f5f8fc, superficies #ffffff/#eaf0f7, texto #142238,
texto secundario #495c73, primario #006779 y foco #00758a. Los estados se
oscurecen para mantener contraste: OK #126b3c, defecto #b42332 y aviso #704700.
La tabla siguiente detalla el modo oscuro.

| Token | Valor | Uso |
| --- | --- | --- |
| background | #101827 | Fondo principal |
| surface | #253349 | Paneles y estados de interacción |
| surface-raised | #1a273a | Tarjetas, formulario y navegación lateral |
| foreground | #f1f5f9 | Texto principal |
| muted-foreground | #b2c1d3 | Texto secundario |
| border | #3b4d65 | Separadores y bordes decorativos |
| input-border | #7b8da6 | Contorno distinguible de campos y controles |
| primary / primary-foreground | #22b8cf / #101827 | Acciones principales y enlaces |
| accent / accent-foreground | #ffab72 / #101827 | Acento de la marca |
| ok | #65dfa0 | Estado OK |
| defect | #ff9393 | Estado defectuoso y errores |
| warning | #f4ce77 | Advertencias |
| ring | #45d9ed | Foco visible |

Los tonos de estado se aclaran respecto de la paleta de referencia para conservar
contraste AA sobre fondos oscuros. Los veredictos usan texto e icono sobre fondos
tenues del mismo estado, sin depender exclusivamente del color.

Las clases compartidas `ui-button`, `ui-button-secondary`, `ui-input`, `ui-card`
y `ui-eyebrow` están en la capa components de globals.css; las utilidades Tailwind
pueden ajustar sus dimensiones. Las transiciones respetan prefers-reduced-motion.

### Contraste y accesibilidad

`src/styles/tokens.test.ts` comprueba 4.5:1 para texto y 3:1 para foco y bordes
de controles, incluidas las superficies elevadas. Playwright y axe revisan las seis
pantallas a 360, 768 y 1280 px. Son comprobaciones automatizadas y de teclado;
no sustituyen una auditoría completa con tecnologías de asistencia.

## Tipografía

| Token | Fuente | Utilidad | Uso |
| --- | --- | --- | --- |
| `--font-sans` | [Geist](https://vercel.com/font) | `font-sans` (por defecto) | Toda la interfaz |
| `--font-mono` | Geist Mono | `font-mono` | Códigos de pieza, lote y molde; versiones del modelo; datos tabulares |

Las fuentes se cargan con `next/font/google` en `apps/web/src/app/layout.tsx`, por lo que se sirven desde el propio dominio y no bloquean el renderizado. Para cifras alineadas en tablas y KPIs se usa `tabular-nums`.

## Cómo añadir o cambiar un token

1. Edita `apps/web/src/app/globals.css`: el valor claro en `:root`, el oscuro en el bloque `prefers-color-scheme: dark` y, si es nuevo, su mapeo en `@theme inline`.
2. Si es un color de texto o de fondo, añade el par a `tokens.test.ts`.
3. Ejecuta `npm test` en `apps/web`.
4. Actualiza la tabla de este documento.
