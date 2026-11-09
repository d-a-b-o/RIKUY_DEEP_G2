import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createAccount, hasDatabase } from "./support/accounts";
import { seedInspections } from "./support/inspections";

/**
 * HU38 · Reporte de fin de turno (RIKDP-49). Las inspecciones de prueba se
 * crean «ahora» en un turno de 00:00 a 23:59, así que caen en el turno de hoy.
 * Los datos no se borran: las inspecciones son inmutables (ADR 0004).
 */
test.describe("Reporte de fin de turno (HU38)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  test("el Admin de planta ve el resumen y descarga el PDF y el Excel", { tag: "@regression" }, async ({
    page,
    signInPage,
  }) => {
    const admin = await createAccount("ADMIN");
    await seedInspections(admin.email, 3);

    await signInPage.goto("/panel");
    await signInPage.signIn(admin.email, admin.password);
    await page.getByRole("link", { name: "Reportes" }).click();
    await expect(page).toHaveURL(/\/panel\/reportes$/);

    await page.getByRole("combobox", { name: "Turno" }).selectOption({ label: "Turno E2E (00:00–23:59)" });
    await page.getByRole("button", { name: "Ver resumen" }).click();
    const resumen = page.getByRole("region", { name: /Turno E2E/ });
    await expect(resumen.getByRole("definition").first()).toHaveText("3");
    await expect(resumen).toContainText(/33[.,]3\s?%/);

    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar PDF" }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/^reporte-turno-\d{4}-\d{2}-\d{2}-turno-e2e\.pdf$/);
    expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");

    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar Excel" }).click()]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    expect((await readFile((await xlsx.path())!)).subarray(0, 2).toString()).toBe("PK");

    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  });

  test("un Inspector no puede descargarlo: 403 en la página y en la descarga", { tag: "@regression" }, async ({
    page,
    signInPage,
    account,
  }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.getByRole("link", { name: "Historial" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reportes" })).toHaveCount(0);
    expect((await page.goto("/panel/reportes"))?.status()).toBe(403);
    const api = await page.request.get("/panel/reportes/turno?fecha=2026-11-08&turno=00000000-0000-4000-8000-000000000000");
    expect(api.status()).toBe(403);
  });
});
