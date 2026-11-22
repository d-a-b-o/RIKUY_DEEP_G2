import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";
import { serveModelFixture } from "./support/model";

/**
 * PT4 · RIKDP-196 — De la captura al veredicto en pantalla en menos de 2 s.
 *
 * Con el modelo real ya cargado, se mide desde el clic en «Inspeccionar»
 * hasta que el veredicto está visible, 10 veces con la cámara simulada de
 * Chromium. El criterio es el percentil 95 < 2000 ms. La carga inicial del
 * modelo se mide aparte (HU26) y no forma parte de esta métrica.
 */

const modelDir = process.env.E2E_MODEL_DIR;
const manifestUrl = process.env.NEXT_PUBLIC_MODEL_MANIFEST_URL;
const SAMPLES = 10;
const LIMIT_MS = 2000;

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  },
});

test.describe("Captura → veredicto (RIKDP-196)", { tag: "@ui" }, () => {
  test.skip(!hasDatabase() || !modelDir || !manifestUrl, "Necesita PostgreSQL y una copia de prueba del modelo real.");

  test("p95 del tiempo de captura a veredicto por debajo de 2 s", async ({ page, signInPage, account }, testInfo) => {
    test.setTimeout(180_000);
    await serveModelFixture(page, modelDir!, manifestUrl!);
    await signInPage.goto("/panel/inspeccion");
    await signInPage.signIn(account.email, account.password);
    await expect(page.getByRole("main").getByRole("status")).toContainText("Modelo", { timeout: 90_000 });
    const backend = (await page.getByRole("main").getByRole("status").innerText()).match(/WebGL|WebAssembly|CPU/)?.[0] ?? "?";

    await page.getByRole("button", { name: "Cámara", exact: true }).click();
    const video = page.getByLabel("Vista de la cámara");
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).videoWidth > 0)).toBe(true);
    const capture = page.getByRole("button", { name: "Inspeccionar", exact: true });

    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      await expect(capture).toBeEnabled();
      const elapsed = await page.evaluate(async () => {
        const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Inspeccionar")!;
        const previous = document.querySelector('[data-testid="veredicto"]');
        const start = performance.now();
        button.click();
        return new Promise<number>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error("sin veredicto en 10 s")), 10_000);
          const check = () => {
            const verdict = document.querySelector('[data-testid="veredicto"]');
            if (verdict && verdict !== previous && verdict.isConnected) {
              clearTimeout(deadline);
              resolve(performance.now() - start);
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
      });
      times.push(Math.round(elapsed));
    }

    const sorted = [...times].sort((x, y) => x - y);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    const summary = { backend, samples: times, medianMs: median, p95Ms: p95, limitMs: LIMIT_MS };
    await testInfo.attach("captura-veredicto.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
    const evidence = process.env.UI_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(path.join(evidence, "rikdp-196-captura-veredicto.json"), JSON.stringify(summary, null, 2));
    }
    expect(p95, `tiempos: ${times.join(", ")} ms`).toBeLessThan(LIMIT_MS);
  });
});
