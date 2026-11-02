import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/** Sirve una copia del modelo real sin depender de la red durante las pruebas. */
export async function serveModelFixture(
  page: Page,
  directory: string,
  manifestUrl: string,
) {
  const root = path.resolve(directory);
  await page.route(`${new URL(manifestUrl).origin}/**`, async (route) => {
    const file = path.resolve(
      root,
      `.${decodeURIComponent(new URL(route.request().url()).pathname)}`,
    );
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
      return route.fulfill({ status: 404 });
    await route.fulfill({
      body: fs.readFileSync(file),
      contentType: file.endsWith(".json")
        ? "application/json"
        : "application/octet-stream",
      headers: { "access-control-allow-origin": "*" },
    });
  });
}
