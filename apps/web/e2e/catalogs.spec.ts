import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createAccount, deleteAccount, hasDatabase, type TestAccount } from "./support/accounts";

/** HU31 · Catálogos (RIKDP-42) y HU33 · Lotes y turnos (RIKDP-44). */
test.describe("Catálogos de planta (HU31, HU33)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  let admin: TestAccount;

  test.beforeEach(async () => {
    admin = await createAccount("ADMIN");
  });

  test.afterEach(async () => {
    // Sin inspecciones, los catálogos se pueden borrar con la cuenta.
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const company = `(SELECT company_id FROM "user" WHERE email = $1)`;
    await client.query(`DELETE FROM batch WHERE company_id = ${company}`, [admin.email]);
    await client.query(`DELETE FROM mold WHERE company_id = ${company}`, [admin.email]);
    await client.query(`DELETE FROM part WHERE company_id = ${company}`, [admin.email]);
    await client.query(`DELETE FROM shift WHERE company_id = ${company}`, [admin.email]);
    await client.end();
    await deleteAccount(admin);
  });

  test("el Admin de planta registra turno, pieza, molde y lote", { tag: "@regression" }, async ({ page, signInPage }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(admin.email, admin.password);
    await page.getByRole("link", { name: "Catálogos" }).click();
    await expect(page).toHaveURL(/\/panel\/catalogos$/);

    // Turno de todo el día: siempre es el activo.
    const shiftForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Registrar turno" }) });
    await shiftForm.getByLabel("Nombre").fill("Todo el día");
    await shiftForm.getByLabel("Inicio").fill("00:00");
    await shiftForm.getByLabel("Fin").fill("23:59");
    await shiftForm.getByRole("button", { name: "Registrar turno" }).click();
    await expect(page.getByText("Turno registrado.")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Turno activo ahora" })).toContainText("Todo el día");

    // Un turno superpuesto se rechaza con el motivo.
    await shiftForm.getByLabel("Nombre").fill("Choque");
    await shiftForm.getByLabel("Inicio").fill("10:00");
    await shiftForm.getByLabel("Fin").fill("12:00");
    await shiftForm.getByRole("button", { name: "Registrar turno" }).click();
    await expect(page.getByText(/Se superpone con el turno «Todo el día»/)).toBeVisible();

    const partForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Registrar pieza" }) });
    await partForm.getByLabel("Código").fill("imp-150");
    await partForm.getByLabel("Nombre").fill("Impulsor 150 mm");
    await partForm.getByRole("button", { name: "Registrar pieza" }).click();
    await expect(page.getByRole("heading", { name: "IMP-150 · Impulsor 150 mm" })).toBeVisible();

    await page.getByText("Editar pieza o agregar molde").click();
    const moldForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Agregar molde" }) });
    await moldForm.getByLabel("Código del molde").fill("M-12");
    await moldForm.getByRole("button", { name: "Agregar molde" }).click();
    await expect(page.getByText(/M-12 · 1 cavidad/)).toBeVisible();

    const batchForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Abrir lote" }) });
    await batchForm.getByLabel("Código del lote").fill("L-2026-118");
    await batchForm.getByLabel("Molde").selectOption({ label: "M-12 · IMP-150" });
    await batchForm.getByRole("button", { name: "Abrir lote" }).click();
    const row = page.getByRole("row").filter({ hasText: "L-2026-118" });
    await expect(row).toContainText("Abierto");
    await row.getByRole("button", { name: "Cerrar L-2026-118" }).click();
    await expect(row).toContainText("Cerrado");

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Eliminar L-2026-118" }).click();
    await expect(page.getByRole("row").filter({ hasText: "L-2026-118" })).toHaveCount(0);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px`).toBe(true);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  });

  test("el Inspector consulta los catálogos pero no los modifica", { tag: "@regression" }, async ({
    page,
    signInPage,
    account,
  }) => {
    await signInPage.goto("/panel/catalogos");
    await signInPage.signIn(account.email, account.password);
    await expect(page.getByRole("heading", { name: "Catálogos", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Turnos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar pieza" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Registrar turno" })).toHaveCount(0);
  });
});
