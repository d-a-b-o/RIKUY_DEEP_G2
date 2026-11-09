import { defineConfig, devices } from "@playwright/test";

// Validación exploratoria aislada del Inspector real: sin sesión, DB ni cámara física.
// El cargador de IA se sustituye SOLO en el bundle de este servidor de pruebas.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "camera-exploratory.spec.ts",
  outputDir: "./test-results/camera",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/camera", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3101",
    locale: "es-PE",
    timezoneId: "America/Lima",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/support/camera-server.mjs",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
