import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createAccount, hasDatabase } from "./support/accounts";
import { seedInspections } from "./support/inspections";

/**
 * HU37 · Dashboard de calidad (RIKDP-48). Las inspecciones de prueba son de
 * «ahora», así que caen en el rango por defecto (últimos 7 días). Los datos no
 * se borran: las inspecciones son inmutables (ADR 0004).
 */
test.describe("Dashboard de calidad (HU37)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  test("muestra KPI, cortes, tendencia y ranking, y filtra", { tag: "@regression" }, async ({ page, signInPage }) => {
    const viewer = await createAccount("VIEWER");
    await seedInspections(viewer.email, 4);

    await signInPage.goto("/panel");
    await signInPage.signIn(viewer.email, viewer.password);
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/panel\/dashboard$/);

    const kpis = page.getByRole("region", { name: "Indicadores del período" });
    await expect(kpis.getByRole("definition").first()).toHaveText("4");
    await expect(kpis).toContainText(/25\s?%/);
    await expect(page.getByRole("heading", { name: "Por turno" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Por turno (se desplaza de lado)" })).toContainText("Turno E2E");
    await expect(page.getByRole("img", { name: "Inspecciones por día: OK y defectuosas" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Leyenda" })).toContainText("Defectuosas");
    const ranking = page.getByRole("region", { name: "Moldes con más defectuosas" });
    await expect(ranking.getByRole("listitem").first()).toContainText("M-E2E · IMP-E2E");

    await page.getByText("Ver como tabla").click();
    await expect(page.getByRole("region", { name: "Tendencia diaria en tabla" }).getByRole("row")).toHaveCount(8);

    // Un rango sin datos deja todo en cero.
    await page.getByLabel("Desde").fill("2020-01-01");
    await page.getByLabel("Hasta").fill("2020-01-07");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(page.getByText("No hay inspecciones con estos filtros.")).toBeVisible();

    await page.goto("/panel/dashboard");
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px`).toBe(true);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  });

  test("el Inspector también lo consulta (dashboard:ver)", { tag: "@regression" }, async ({ page, signInPage, account }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);
    expect((await page.goto("/panel/dashboard"))?.status()).toBe(200);
  });
});
