import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";
import { serveModelFixture } from "./support/model";

const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;
const modelDir = process.env.E2E_MODEL_DIR;
test.skip(
  !hasDatabase() || !manifestUrl || !modelDir,
  "Necesita PostgreSQL aislado y fixture local del modelo TF.js.",
);
test.setTimeout(120_000);

async function capture(page: import("@playwright/test").Page, name: string) {
  const directory = process.env.TFJS_EVIDENCE_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage: true,
  });
}
async function accessible(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test(
  "manifest fallido, reintento fallido y recuperación sin recargar ni duplicar cargas",
  { tag: "@regression" },
  async ({ page, signInPage, account }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await serveModelFixture(page, modelDir!, manifestUrl!);
    let requests = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(manifestUrl!, async (route) => {
      requests++;
      if (requests <= 2)
        return route.fulfill({
          status: 503,
          body: "internal secret must not be displayed",
        });
      await pending;
      await route.fallback();
    });
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    const region = page.getByRole("region", { name: "Estado del modelo" });
    const retry = page.getByRole("button", {
      name: "Reintentar inicialización",
    });
    await expect(region.getByRole("alert")).toContainText(
      "Comprueba tu conexión",
    );
    await expect(region).not.toContainText("internal secret");
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await accessible(page);
    await capture(page, "error-movil-claro");
    // A page reload would erase this marker.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).retryMarker =
        "same-document";
    });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(retry).toBeVisible();
    expect(requests).toBe(2);
    await retry.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(region.getByRole("status")).toContainText("Reintentando");
    await expect(region).toBeFocused();
    await expect(retry).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await accessible(page);
    await capture(page, "reintentando-movil-claro");
    await expect.poll(() => requests).toBe(3);
    release();
    await expect(region.getByRole("status")).toContainText("Modelo", {
      timeout: 90_000,
    });
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    expect(requests).toBe(3);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).retryMarker,
      ),
    ).toBe("same-document");
    await page
      .locator('input[type="file"]')
      .setInputFiles(path.join(modelDir!, "referencia-ok.png"));
    await expect(page.getByTestId("veredicto")).toHaveAttribute(
      "data-verdict",
      "OK",
    );
    await capture(page, "recuperado-movil-claro");
  },
);

test(
  "descarga fallida se recupera y la siguiente carga usa IndexedDB sin descargar pesos",
  { tag: "@regression" },
  async ({ page, signInPage, account }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await serveModelFixture(page, modelDir!, manifestUrl!);
    let failDownload = true;
    let offline = false;
    let downloads = 0;
    await page.route(manifestUrl!, (route) =>
      offline ? route.fulfill({ status: 503 }) : route.fallback(),
    );
    await page.route("**/model.json", (route) => {
      downloads++;
      return failDownload ? route.fulfill({ status: 503 }) : route.fallback();
    });
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    const region = page.getByRole("region", { name: "Estado del modelo" });
    await expect(region.getByRole("alert")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await capture(page, "descarga-fallida-escritorio-oscuro");
    failDownload = false;
    await page
      .getByRole("button", { name: "Reintentar inicialización" })
      .click();
    await expect(region.getByRole("status")).toContainText("Modelo", {
      timeout: 90_000,
    });
    const count = downloads;
    offline = true;
    await page.reload();
    await expect(region.getByRole("status")).toContainText(
      "Desde este equipo",
      { timeout: 90_000 },
    );
    await expect(region).toContainText("Sin conexión");
    expect(downloads).toBe(count);
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    await accessible(page);
    await capture(page, "cache-offline-escritorio-oscuro");
  },
);

test(
  "manifest inválido explica cómo corregirlo y no ofrece reintentos inútiles",
  { tag: "@regression" },
  async ({ page, signInPage, account }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.route(manifestUrl!, (route) =>
      route.fulfill({ json: { schemaVersion: "secret config" } }),
    );
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    const region = page.getByRole("region", { name: "Estado del modelo" });
    await expect(region.getByRole("alert")).toContainText(
      "configuración del modelo no es válida",
    );
    await expect(region).not.toContainText("secret config");
    await expect(
      page.getByRole("button", { name: "Reintentar inicialización" }),
    ).toHaveCount(0);
    await accessible(page);
    await capture(page, "configuracion-invalida-escritorio-oscuro");
  },
);

test.describe("fallback WASM real", () => {
  test(
    "inicializa y clasifica cuando WebGL no está disponible",
    { tag: "@regression" },
    async ({ page, signInPage, account }) => {
      // Simulate unsupported WebGL; TF.js and its WASM runtime remain real.
      await page.addInitScript(() => {
        for (const prototype of [
          HTMLCanvasElement.prototype,
          typeof OffscreenCanvas !== "undefined"
            ? OffscreenCanvas.prototype
            : null,
        ]) {
          if (!prototype) continue;
          const original = prototype.getContext;
          Object.defineProperty(prototype, "getContext", {
            value: function (
              this: HTMLCanvasElement | OffscreenCanvas,
              type: string,
              ...options: unknown[]
            ) {
              return type.includes("webgl")
                ? null
                : Reflect.apply(original, this, [type, ...options]);
            },
          });
        }
      });
      await serveModelFixture(page, modelDir!, manifestUrl!);
      await signInPage.goto("/panel/inspeccion");
      await signInPage.signIn(account.email, account.password);
      const region = page.getByRole("region", { name: "Estado del modelo" });
      await expect(region.getByRole("status")).toContainText("WebAssembly", {
        timeout: 90_000,
      });
      await page
        .locator('input[type="file"]')
        .setInputFiles(path.join(modelDir!, "referencia-ok.png"));
      await expect(page.getByTestId("veredicto")).toHaveAttribute(
        "data-verdict",
        "OK",
      );
      await capture(page, "fallback-wasm-real");
    },
  );
});
