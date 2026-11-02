import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de sistema (E2E) con Playwright. Plan de pruebas v1.1, sección 4.
 *
 * - Sin PLAYWRIGHT_BASE_URL, levanta la compilación de producción local
 *   (`npm run build` antes) en el puerto 3100.
 * - Con PLAYWRIGHT_BASE_URL, prueba contra una URL ya desplegada, por ejemplo
 *   el preview de Vercel de una PR.
 * - El proyecto msedge se activa con PLAYWRIGHT_EDGE=1 (requiere Edge instalado).
 */
const isCI = Boolean(process.env.CI);
const port = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "es-PE",
    timezoneId: "America/Lima",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(process.env.PLAYWRIGHT_EDGE === "1"
      ? [{ name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } }]
      : []),
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run start -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 60_000,
      },
});
