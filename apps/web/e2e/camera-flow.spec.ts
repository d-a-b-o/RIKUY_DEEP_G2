import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";
import { serveModelFixture } from "./support/model";

const modelDir = process.env.E2E_MODEL_DIR;
const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;

// Chromium genera el dispositivo: ni el permiso ni la webcam son físicos.
// A diferencia del harness, esta suite usa sesión, ruta Next y TF.js reales.
test.use({ launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
] } });
test.skip(!hasDatabase() || !modelDir || !manifestUrl,
  "Requiere PostgreSQL de pruebas y copia local del modelo real.");

for (const name of ["NotAllowedError", "NotFoundError"] as const) {
  test(`RIKDP-288: ${name} y recuperación con TF.js real`, async ({ page, signInPage, account }) => {
    test.setTimeout(120_000);
    await serveModelFixture(page, modelDir!, manifestUrl!);
    await page.addInitScript((name) => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let first = true;
      navigator.mediaDevices.getUserMedia = (constraints) => {
        if (first) {
          first = false;
          return Promise.reject(new DOMException("Fallo simulado de QA", name));
        }
        return getUserMedia(constraints);
      };
    }, name);
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    await expect(page.getByRole("main").getByRole("status")).toContainText("Modelo 0.9.0", { timeout: 90_000 });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.getByRole("button", { name: "Cámara", exact: true }).click();
    const capture = page.getByRole("button", { name: "Inspeccionar", exact: true });
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText(name === "NotAllowedError" ? "no tiene permiso" : "No se pudo iniciar");
    await expect(capture).toBeDisabled();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    if (process.env.CAMERA_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.CAMERA_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.CAMERA_EVIDENCE_DIR, `ruta-real-${name}-360.png`), fullPage: true });
    }
    const retry = page.getByRole("button", { name: "Reintentar cámara" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(capture).toBeEnabled();
    await expect(alert).toHaveCount(0);
    await capture.click();
    await expect(page.getByTestId("veredicto")).toBeVisible();
    await expect(page.getByRole("main").getByText("Confianza", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/panel\/inspeccion$/);
    if (process.env.CAMERA_EVIDENCE_DIR) {
      await page.screenshot({ path: path.join(process.env.CAMERA_EVIDENCE_DIR, `ruta-real-recuperada-${name}-360.png`), fullPage: true });
    }
  });
}

test("RIKDP-288: desconexión simulada en la ruta autenticada", async ({ page, signInPage, account }) => {
  test.setTimeout(120_000);
  await serveModelFixture(page, modelDir!, manifestUrl!);
  await signInPage.goto("/panel/inspeccion");
  await signInPage.signIn(account.email, account.password);
  await expect(page.getByRole("main").getByRole("status")).toContainText("Modelo 0.9.0", { timeout: 90_000 });
  await page.getByRole("button", { name: "Cámara", exact: true }).click();
  const capture = page.getByRole("button", { name: "Inspeccionar", exact: true });
  await expect(capture).toBeEnabled();
  await page.getByLabel("Vista de la cámara").evaluate((element) => {
    const stream = (element as HTMLVideoElement).srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("se desconectó");
  await expect(capture).toBeDisabled();
  await page.getByRole("button", { name: "Reintentar cámara" }).click();
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByTestId("veredicto")).toBeVisible();
});
