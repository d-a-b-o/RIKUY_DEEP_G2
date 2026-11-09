import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    mediaQA: {
      mode: "ready" | "denied" | "absent" | "busy" | "pending";
      streams: MediaStream[];
      requests: number;
      noFrames: boolean;
      playFails: boolean;
      resolvePending?: () => void;
    };
  }
}

// El archivo sólo corre mediante playwright.camera.config.ts.
// No usa getUserMedia nativo: todos los píxeles salen de un canvas sintético.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.cameraQA = { model: "ready", predictionFails: false, predictions: 0, holdPrediction: false };
    const model = new URL(location.href).searchParams.get("model");
    if (model === "loading" || model === "error") window.cameraQA.model = model;
    window.mediaQA = { mode: "ready", streams: [], requests: 0, noFrames: false, playFails: false };
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (window.mediaQA.playFails) return Promise.reject(new DOMException("QA", "NotSupportedError"));
      return originalPlay.call(this);
    };
    const readyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState")!;
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      get() { return window.mediaQA.noFrames ? 0 : readyState.get!.call(this); },
    });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        if (constraints.audio !== false) throw new Error("No se debe solicitar micrófono");
        const state = window.mediaQA;
        state.requests++;
        const names = { denied: "NotAllowedError", absent: "NotFoundError", busy: "NotReadableError" };
        if (state.mode in names) throw new DOMException("QA", names[state.mode as keyof typeof names]);
        if (state.mode === "pending") await new Promise<void>((resolve) => { state.resolvePending = resolve; });
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext("2d")!;
        const paint = () => {
          context.fillStyle = "#227755";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "#eeeeee";
          context.fillRect(440, 160, 400, 400);
        };
        paint();
        const stream = canvas.captureStream(10);
        const timer = setInterval(paint, 100);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { clearInterval(timer); stop(); };
        }
        state.streams.push(stream);
        return stream;
      },
    } });
  });
});

const camera = (page: Page) => page.getByRole("button", { name: "Cámara", exact: true });
const capture = (page: Page) => page.getByRole("button", { name: "Inspeccionar", exact: true });
const retry = (page: Page) => page.getByRole("button", { name: "Reintentar cámara" });
async function openCamera(page: Page, url = "/") {
  await page.goto(url);
  await camera(page).click();
}
async function evidence(page: Page, name: string) {
  const directory = process.env.CAMERA_EVIDENCE_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}
async function allStopped(page: Page) {
  await expect.poll(() => page.evaluate(() => window.mediaQA.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")))).toBe(true);
}

test("captura sintética, recorte y resultado; libera al cambiar de origen", async ({ page }) => {
  await openCamera(page);
  await expect(capture(page)).toBeEnabled();
  await capture(page).click();
  await expect(page.getByTestId("veredicto")).toHaveText("OK");
  await expect(page.getByText("Confianza", { exact: true })).toBeVisible();
  await expect(page.getByText("Modelo 0.0.0-qa-simulada")).toBeVisible();
  const pixel = await page.getByLabel("Imagen que analizó el modelo").evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, center: [...canvas.getContext("2d")!.getImageData(200, 200, 1, 1).data] };
  });
  expect(pixel).toEqual({ width: 400, height: 400, center: [238, 238, 238, 255] });
  await evidence(page, "captura-sintetica-escritorio");
  await page.getByRole("button", { name: "Subir imagen", exact: true }).click();
  await allStopped(page);
});

for (const [mode, message] of [
  ["denied", "no tiene permiso"],
  ["absent", "No se pudo iniciar"],
  ["busy", "No se pudo iniciar"],
] as const) {
  test(`${mode}: error controlado y recuperación sin recargar`, async ({ page }) => {
    await page.goto("/");
    await page.evaluate((mode) => { window.mediaQA.mode = mode; }, mode);
    await camera(page).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(capture(page)).toBeDisabled();
    await evidence(page, `error-${mode}`);
    await page.evaluate(() => { window.mediaQA.mode = "ready"; });
    await retry(page).click();
    await expect(capture(page)).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => window.mediaQA.requests)).toBe(2);
  });
}

test("espera el primer fotograma y controla una cámara sin imágenes", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.evaluate(() => { window.mediaQA.noFrames = true; });
  await camera(page).click();
  await expect.poll(() => page.evaluate(() => window.mediaQA.streams.length)).toBe(1);
  await expect(capture(page)).toBeDisabled();
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("alert")).toContainText("no envía imágenes");
  await allStopped(page);
  await page.evaluate(() => { window.mediaQA.noFrames = false; });
  await retry(page).click();
  await expect(capture(page)).toBeEnabled();
});

test("desconexión/revocación deshabilita captura y permite reconectar", async ({ page }) => {
  await openCamera(page);
  await expect(capture(page)).toBeEnabled();
  await page.evaluate(() => {
    const track = window.mediaQA.streams[0].getVideoTracks()[0];
    track.stop();
    // stop() no emite ended; el evento representa desconexión/revocación externa.
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("alert")).toContainText("se desconectó");
  await expect(capture(page)).toBeDisabled();
  await evidence(page, "desconexion-simulada");
  await retry(page).click();
  await expect(capture(page)).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("detiene, reanuda y libera también solicitudes resueltas después de salir", async ({ page }) => {
  await openCamera(page);
  await expect(capture(page)).toBeEnabled();
  await page.getByRole("button", { name: "Detener cámara" }).click();
  await allStopped(page);
  await expect(capture(page)).toBeDisabled();
  await expect(page.getByText("Cámara detenida.")).toBeVisible();
  await retry(page).click();
  await expect(capture(page)).toBeEnabled();
  await page.getByRole("button", { name: "Subir imagen", exact: true }).click();
  await page.evaluate(() => { window.mediaQA.mode = "pending"; });
  await camera(page).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.mediaQA.resolvePending))).toBe(true);
  await page.getByRole("button", { name: "Subir imagen", exact: true }).click();
  await page.evaluate(() => window.mediaQA.resolvePending!());
  await expect.poll(() => page.evaluate(() => window.mediaQA.streams.length)).toBe(3);
  await allStopped(page);
});

test("fallo de reproducción libera la cámara y se recupera", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { window.mediaQA.playFails = true; });
  await camera(page).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo iniciar");
  await allStopped(page);
  await expect(capture(page)).toBeDisabled();
  await page.evaluate(() => { window.mediaQA.playFails = false; });
  await retry(page).click();
  await expect(capture(page)).toBeEnabled();
});

test("API multimedia ausente muestra acción comprensible", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => Object.defineProperty(navigator, "mediaDevices", { value: undefined }));
  await camera(page).click();
  await expect(page.getByRole("alert")).toContainText("HTTPS");
  await expect(capture(page)).toBeDisabled();
});

for (const model of ["loading", "error"] as const) {
  test(`modelo ${model}: no ejecuta predicción`, async ({ page }) => {
    await openCamera(page, `/?model=${model}`);
    await expect(page.getByText("Cámara lista para capturar.")).toBeVisible();
    await expect(capture(page)).toBeDisabled();
    expect(await page.evaluate(() => window.cameraQA.predictions)).toBe(0);
    if (model === "error") await expect(page.getByRole("alert")).toContainText("No se pudo cargar");
  });
}

test("inferencia fallida oculta el veredicto anterior y permite reintento", async ({ page }) => {
  await openCamera(page);
  await expect(capture(page)).toBeEnabled();
  await capture(page).click();
  await expect(page.getByTestId("veredicto")).toBeVisible();
  await page.evaluate(() => { window.cameraQA.predictionFails = true; });
  await capture(page).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo inspeccionar");
  await expect(page.getByTestId("veredicto")).toHaveCount(0);
  await expect(page.getByText("Detalle interno", { exact: false })).toHaveCount(0);
  await expect(capture(page)).toBeEnabled();
  await evidence(page, "inferencia-fallida-simulada");
  await page.evaluate(() => { window.cameraQA.predictionFails = false; });
  await capture(page).click();
  await expect(page.getByTestId("veredicto")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("bloquea capturas mientras la predicción está pendiente", async ({ page }) => {
  await openCamera(page);
  await page.evaluate(() => { window.cameraQA.holdPrediction = true; });
  await expect(capture(page)).toBeEnabled();
  await capture(page).click();
  await expect(capture(page)).toBeDisabled();
  await expect(page.getByText("Inspeccionando…", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.cameraQA.predictions)).toBe(1);
  await page.evaluate(() => window.cameraQA.releasePrediction!());
  await expect(capture(page)).toBeEnabled();
});

test("error de captura no conserva el resultado de otra pieza", async ({ page }) => {
  await openCamera(page);
  await expect(capture(page)).toBeEnabled();
  await capture(page).click();
  await expect(page.getByTestId("veredicto")).toBeVisible();
  await page.evaluate(() => { window.mediaQA.noFrames = true; });
  await capture(page).click();
  await expect(page.getByRole("alert")).toContainText("no tiene un fotograma");
  await expect(page.getByTestId("veredicto")).toHaveCount(0);
  expect(await page.evaluate(() => window.cameraQA.predictions)).toBe(1);
  await page.evaluate(() => { window.mediaQA.noFrames = false; });
  await capture(page).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("veredicto")).toBeVisible();
});

for (const width of [360, 768, 1280]) {
  test(`teclado, axe y adaptación a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await camera(page).focus();
    await page.keyboard.press("Enter");
    await expect(capture(page)).toBeEnabled();
    await capture(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("veredicto")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await evidence(page, `teclado-${width}`);
  });
}
