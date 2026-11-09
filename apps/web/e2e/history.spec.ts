import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createAccount, hasDatabase, type TestAccount } from "./support/accounts";
import { seedInspections, type SeededInspections } from "./support/inspections";

/**
 * HU40 · Corregir veredictos y consultar el historial (RIKDP-51) y
 * HU42 · Historial de inspecciones (RIKDP-53).
 *
 * Los datos de estas pruebas no se borran: las inspecciones son inmutables (ADR 0004).
 */
test.describe("Historial y correcciones (HU40, HU42)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  let inspector: TestAccount;
  let seeded: SeededInspections;

  test.beforeEach(async () => {
    inspector = await createAccount("INSPECTOR");
    seeded = await seedInspections(inspector.email, 3);
  });

  test("filtra el historial, abre el detalle y corrige con motivo", { tag: "@regression" }, async ({ page, signInPage }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(inspector.email, inspector.password);
    await page.getByRole("link", { name: "Historial" }).click();
    await expect(page).toHaveURL(/\/panel\/inspecciones$/);
    await expect(page.getByRole("row")).toHaveCount(4); // encabezado + 3

    // Filtro combinable: solo defectuosas.
    await page.getByRole("combobox", { name: "Veredicto" }).selectOption("DEFECTIVE");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page).toHaveURL(/veredicto=DEFECTIVE/);
    await expect(page.getByRole("row")).toHaveCount(2);

    // Detalle de una OK: datos, versión del modelo y trazabilidad.
    await page.goto(`/panel/inspecciones/${seeded.ids[1]}`);
    await expect(page.getByRole("heading", { name: "Inspección" })).toBeVisible();
    await expect(page.getByText(seeded.modelVersion, { exact: true })).toBeVisible();
    await expect(page.getByText(seeded.batchCode)).toBeVisible();

    // El motivo es obligatorio.
    await page.getByRole("button", { name: "Corregir a Defectuosa" }).click();
    await expect(page.getByLabel("Motivo de la corrección")).toBeFocused();

    await page.getByLabel("Motivo de la corrección").fill("Porosidad visible en el borde");
    await page.getByRole("button", { name: "Corregir a Defectuosa" }).click();
    await expect(page.getByRole("status")).toContainText("marcada para reentrenamiento");
    await expect(page.getByText("Veredicto corregido: OK → Defectuosa")).toBeVisible();
    await expect(page.getByText("Motivo: Porosidad visible en el borde")).toBeVisible();
    await expect(page.getByText("Marcada para reentrenamiento").first()).toBeVisible();

    // Aparece al filtrar las marcadas para reentrenamiento.
    await page.goto("/panel/inspecciones?reentrenamiento=1");
    await expect(page.getByRole("row")).toHaveCount(2);
  });

  test.describe("Visualizador", () => {
    test("consulta el historial pero no puede corregir", { tag: "@regression" }, async ({ page, signInPage }) => {
      const viewer = await createAccount("VIEWER");
      const own = await seedInspections(viewer.email, 1);
      await signInPage.goto("/panel/inspecciones");
      await signInPage.signIn(viewer.email, viewer.password);
      await expect(page.getByRole("row")).toHaveCount(2);
      await page.goto(`/panel/inspecciones/${own.ids[0]}`);
      await expect(page.getByRole("heading", { name: "Trazabilidad" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Corregir el veredicto" })).toHaveCount(0);

      // Una inspección de otra empresa no existe para él (no se revela ningún dato).
      await page.goto(`/panel/inspecciones/${seeded.ids[0]}`);
      await expect(page.getByText(/could not be found|no existe|404/i).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Trazabilidad" })).toHaveCount(0);
      await expect(page.getByText(seeded.batchCode)).toHaveCount(0);
    });
  });

  test("el historial y el detalle no tienen scroll horizontal ni fallos de accesibilidad", { tag: "@regression" }, async ({
    page,
    signInPage,
  }) => {
    await signInPage.goto("/panel/inspecciones");
    await signInPage.signIn(inspector.email, inspector.password);
    for (const route of ["/panel/inspecciones", `/panel/inspecciones/${seeded.ids[0]}`]) {
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await expect(page.getByRole("main")).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${route} a ${width}px`,
        ).toBe(true);
      }
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })), route).toEqual([]);
    }
  });
});
