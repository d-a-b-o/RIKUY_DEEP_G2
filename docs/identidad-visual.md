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

### Tokens semánticos

En los componentes se usan **los tokens semánticos, no las escalas**: así el tema oscuro funciona sin tocar cada componente.

| Token | Utilidad de Tailwind | Claro | Oscuro | Uso |
| --- | --- | --- | --- | --- |
| `background` | `bg-background` | `#ffffff` | `#0b1b29` | Fondo de página |
| `surface` | `bg-surface` | `#f4f7fa` | `#122a3d` | Tarjetas, paneles, inputs |
| `foreground` | `text-foreground` | `#122a3d` | `#e8eef3` | Texto principal |
| `muted-foreground` | `text-muted-foreground` | `#4a5d6e` | `#a9b8c6` | Texto secundario |
| `border` | `border-border` | `#cfd9e2` | `#2b4458` | Bordes y separadores |
| `primary` | `bg-primary`, `text-primary` | `#1f5075` | `#74a2c3` | Botón principal, enlaces |
| `primary-foreground` | `text-primary-foreground` | `#ffffff` | `#0b1b29` | Texto sobre `primary` |
| `accent` | `bg-accent`, `text-accent` | `#c2410c` | `#ff8a4c` | Llamadas a la acción destacadas |
| `accent-foreground` | `text-accent-foreground` | `#ffffff` | `#0b1b29` | Texto sobre `accent` |
| `ok` | `text-ok`, `bg-ok` | `#15803d` | `#4ade80` | Veredicto **OK** |
| `defect` | `text-defect`, `bg-defect` | `#b91c1c` | `#f87171` | Veredicto **defectuosa**, errores |
| `warning` | `text-warning`, `bg-warning` | `#a16207` | `#facc15` | Avisos, baja confianza |
| `ring` | `outline-ring` | `#e2550f` | `#ff8a4c` | Foco de teclado |

El foco de teclado (`:focus-visible`) ya tiene un contorno de 2 px en `ring` para toda la app.

El veredicto nunca se comunica solo con color: va siempre acompañado de texto («OK», «Defectuosa») o de un icono, para usuarios con daltonismo.

### Contraste (WCAG 2.1 AA)

`apps/web/src/styles/tokens.test.ts` lee `globals.css` y comprueba en ambos temas:

- 4.5:1 para texto sobre `background` y `surface`, y para el texto sobre `primary` y `accent`.
- 3:1 para el indicador de foco (`ring`) sobre `background`.

Si un cambio de color rompe el contraste, `npm test` falla y el CI bloquea la PR. Esta prueba cubre la parte estática de RIKDP-92 (PT5 · contraste de la paleta WCAG AA).

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
