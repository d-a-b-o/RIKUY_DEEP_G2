import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";

/**
 * Inspección con el modelo real en el navegador (HU26).
 *
 * Necesita una copia local del bucket de modelos en E2E_MODEL_DIR (con
 * dev/manifest.json y dev/v0.9.0/...) y una imagen de referencia OK en
 * E2E_MODEL_DIR/referencia-ok.png. Las peticiones al bucket se sirven desde esa
 * carpeta, así la prueba no depende de la red. Sin esas variables se omite.
 */
const modelDir = process.env.E2E_MODEL_DIR;
const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;

test.skip(!hasDatabase() || !modelDir || !manifestUrl, "Necesita DATABASE_URL, E2E_MODEL_DIR y NEXT_PUBLIC_MODEL_MANIFEST_URL.");

test("clasifica una pieza OK con el modelo en el navegador", { tag: "@regression" }, async ({ page, signInPage, account }) => {
  test.setTimeout(120_000);
  const bucketOrigin = new URL(manifestUrl!).origin;
  await page.route(`${bucketOrigin}/**`, async (route) => {
    const file = path.join(modelDir!, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
    await route.fulfill({
      body: fs.readFileSync(file),
      contentType: file.endsWith(".json") ? "application/json" : "application/octet-stream",
      headers: { "access-control-allow-origin": "*" },
    });
  });

  await signInPage.goto("/panel/inspeccion");
  await signInPage.signIn(account.email, account.password);
  await expect(page).toHaveURL(/\/panel\/inspeccion$/);

  const status = page.getByRole("main").getByRole("status");
  await expect(status).toContainText("Modelo 0.9.0", { timeout: 90_000 });
  await expect(status).toContainText("Provisional");

  await page.locator('input[type="file"]').setInputFiles(path.join(modelDir!, "referencia-ok.png"));

  const verdict = page.getByTestId("veredicto");
  await expect(verdict).toHaveAttribute("data-verdict", "OK", { timeout: 30_000 });
  // En Python la probabilidad de defecto de esta imagen es 0,22 %.
  const probability = Number((await page.getByTestId("probabilidad").innerText()).replace("%", "").replace(",", ".").trim());
  expect(probability).toBeLessThan(1);
});
