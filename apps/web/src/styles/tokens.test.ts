import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)) {
    vars[match[1]] = match[2].toLowerCase();
  }
  return vars;
}

function extractBlock(source: string, startIndex: number): string {
  const open = source.indexOf("{", startIndex);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("Bloque CSS sin cerrar");
}

const darkMediaIndex = css.indexOf("@media (prefers-color-scheme: dark)");
const lightTheme = parseVars(extractBlock(css, css.indexOf(":root")));
const darkTheme = parseVars(extractBlock(css, css.indexOf(":root", darkMediaIndex)));

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// [texto, fondo, contraste mínimo]. 4.5:1 para texto normal (WCAG AA 1.4.3)
// y 3:1 para indicadores de foco y componentes de interfaz (WCAG AA 1.4.11).
const pairs: Array<[string, string, number]> = [
  ["foreground", "background", 4.5],
  ["foreground", "surface", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "surface", 4.5],
  ["primary", "background", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["accent", "background", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["ok", "background", 4.5],
  ["ok", "surface", 4.5],
  ["defect", "background", 4.5],
  ["defect", "surface", 4.5],
  ["warning", "background", 4.5],
  ["warning", "surface", 4.5],
  ["ring", "background", 3],
];

describe.each([
  ["claro", lightTheme],
  ["oscuro", darkTheme],
])("tokens de color · tema %s", (_name, theme) => {
  it("define todos los tokens semánticos", () => {
    const names = new Set(pairs.flatMap(([text, bg]) => [text, bg]));
    for (const name of names) {
      expect(theme[name], `falta --${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(pairs)("%s sobre %s cumple %s:1", (text, background, minimum) => {
    expect(contrastRatio(theme[text], theme[background])).toBeGreaterThanOrEqual(minimum);
  });
});
