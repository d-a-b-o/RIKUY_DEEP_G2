import path from "node:path";
import fs from "node:fs";
import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";
import { serveModelFixture } from "./support/model";

const modelDir = process.env.E2E_MODEL_DIR;
const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;

// Dispositivo y permiso ficticios de Chromium: nunca se accede a la cámara del usuario.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function saveState(page: import("@playwright/test").Page, name: string) {
  const directory = process.env.UI_EVIDENCE_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `despues-inspeccion-${name}-1280.png`),
    fullPage: true,
  });
}

test.describe("Controles de inspección UI", { tag: "@ui" }, () => {
  test.skip(
    !hasDatabase() || !modelDir || !manifestUrl,
    "Necesita PostgreSQL y una copia de prueba del modelo real.",
  );
  test.beforeEach(async ({ page, signInPage, account }) => {
    await serveModelFixture(page, modelDir!, manifestUrl!);
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel\/inspeccion$/);
  });

  test("archivo inválido, foco de teclado y resultado de una imagen real", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Modelo",
      { timeout: 90_000 },
    );
    const input = page.locator('input[type="file"]');
    await input.focus();
    expect(
      await input.evaluate(
        (element) => getComputedStyle(element.closest("label")!).outlineStyle,
      ),
    ).not.toBe("none");
    await input.setInputFiles({
      name: "invalido.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("fixture de archivo inválido"),
    });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "no es una imagen",
    );
    await input.setInputFiles({
      name: "corrupta.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture corrupta"),
    });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "No se pudo leer la imagen",
    );
    await saveState(page, "archivo-corrupto");
    await input.setInputFiles(path.join(modelDir!, "referencia-ok.png"));
    await expect(page.getByTestId("veredicto")).toHaveAttribute(
      "data-verdict",
      "OK",
    );
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await saveState(page, "resultado");
  });

  test("cambia a cámara y captura un fotograma simulado", async ({ page }) => {
    test.setTimeout(120_000);
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Modelo",
      { timeout: 90_000 },
    );
    const camera = page.getByRole("button", { name: "Cámara", exact: true });
    await camera.click();
    await expect(camera).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Vista de la cámara")).toBeVisible();
    const capture = page.getByRole("button", {
      name: "Inspeccionar",
      exact: true,
    });
    await expect(capture).toBeEnabled();
    await capture.click();
    await expect(page.getByTestId("veredicto")).toBeVisible();
    await expect(page.getByText("Tiempo de análisis")).toBeVisible();
    await saveState(page, "camara-simulada");
    await page
      .getByRole("button", { name: "Subir imagen", exact: true })
      .click();
    await expect(camera).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Vista de la cámara")).toHaveCount(0);
  });
});

test.describe("Estados de carga y error de inspección", { tag: "@ui" }, () => {
  test.skip(
    !hasDatabase() || !manifestUrl,
    "Necesita PostgreSQL y URL del manifest.",
  );
  test("bloquea la entrada mientras carga y muestra el fallo del modelo", async ({
    page,
    signInPage,
    account,
  }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(manifestUrl!, async (route) => {
      await pending;
      await route.fulfill({ status: 503 });
    });
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel\/inspeccion$/);
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Consultando",
    );
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await saveState(page, "cargando");
    release();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "No se pudo cargar el modelo",
    );
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await saveState(page, "error-modelo");
  });
});
