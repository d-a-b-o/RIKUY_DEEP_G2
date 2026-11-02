import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";

const evidence = process.env.UI_EVIDENCE_DIR;
const phase = process.env.UI_EVIDENCE_PHASE ?? "despues";
const sizes = [360, 768, 1280];

async function capture(
  page: import("@playwright/test").Page,
  name: string,
  width: number,
  email?: string,
) {
  if (!evidence) return;
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: path.join(evidence, `${phase}-${name}-${width}.png`),
    fullPage: true,
    style: "nextjs-portal { display: none !important; }",
    mask: email ? [page.getByText(email, { exact: true })] : [],
    maskColor: "#3b4d65",
  });
}

async function accessible(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

for (const width of sizes) {
  test.describe(`UI responsive ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const [name, route] of [
      ["landing", "/"],
      ["ingresar", "/ingresar"],
      ["recuperar", "/recuperar"],
      ["restablecer", "/restablecer"],
    ]) {
      test(
        `vista pública ${name}: contraste, etiquetas y sin overflow`,
        { tag: ["@ui", "@smoke"] },
        async ({ page }) => {
          await page.goto(route);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true);
          if (phase === "despues") await accessible(page);
          await capture(page, name, width);
        },
      );
    }
    test.describe("área privada", () => {
      test.skip(
        !hasDatabase(),
        "Necesita base de datos aislada para las cuentas ficticias.",
      );
      for (const [name, route] of [
        ["panel", "/panel"],
        ["inspeccion", "/panel/inspeccion"],
      ]) {
        test(
          `vista privada ${name}: navegación, accesibilidad y sin overflow`,
          { tag: ["@ui", "@smoke"] },
          async ({ page, signInPage, account }) => {
            test.setTimeout(120_000);
            await signInPage.goto(route);
            await signInPage.signIn(account.email, account.password);
            await expect(page).toHaveURL(new RegExp(`${route}$`));
            await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
            if (
              name === "inspeccion" &&
              process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL
            ) {
              await expect(
                page.getByRole("main").getByRole("status"),
              ).toContainText("Modelo", { timeout: 90_000 });
            }
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
            ).toBe(true);
            if (phase === "despues") {
              await expect(
                page
                  .getByRole("navigation", { name: "Panel" })
                  .locator('[aria-current="page"]'),
              ).toHaveCount(1);
              await accessible(page);
            }
            await capture(page, name, width, account.email);
          },
        );
      }
    });
  });
}

test(
  "menú móvil: abre, cierra con Escape y navega a una sección",
  { tag: ["@ui", "@smoke"] },
  async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menú de secciones" });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await page
      .getByRole("navigation", { name: "Secciones" })
      .getByRole("link", { name: "Solución", exact: true })
      .click();
    await expect(page).toHaveURL(/#solucion$/);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  },
);

test(
  "teclado y preferencia de movimiento reducido",
  { tag: ["@ui", "@smoke"] },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al contenido" }),
    ).toBeFocused();
    const style = await page
      .getByRole("link", { name: "Saltar al contenido" })
      .evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          outline: css.outlineStyle,
          width: css.outlineWidth,
          duration: css.transitionDuration,
        };
      });
    expect(style.outline).not.toBe("none");
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
    expect(parseFloat(style.duration)).toBeLessThanOrEqual(0.01);
  },
);
