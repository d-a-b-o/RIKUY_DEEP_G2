import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { expect, test } from "./fixtures";
import { createAccount, deleteAccount, hasDatabase, TEST_PASSWORD, type TestAccount } from "./support/accounts";

/** HU44 · Estación de inspección automática (RIKDP-55): alta, lote asignado y pantalla de la estación. */
test.describe("Estaciones automáticas (HU44)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  let admin: TestAccount;
  let batchCode: string;

  async function sql<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }

  test.beforeEach(async () => {
    admin = await createAccount("ADMIN");
    batchCode = `L-HU44-${randomUUID().slice(0, 6)}`;
    await sql(async (client) => {
      const {
        rows: [{ company_id: companyId }],
      } = await client.query<{ company_id: string }>(`SELECT company_id FROM "user" WHERE email = $1`, [admin.email]);
      const [partId, moldId] = [randomUUID(), randomUUID()];
      await client.query(`INSERT INTO part (id, company_id, code, name, updated_at) VALUES ($1, $2, 'IMP-44', 'Impulsor', now())`, [partId, companyId]);
      await client.query(`INSERT INTO mold (id, company_id, part_id, code, updated_at) VALUES ($1, $2, $3, 'M-44', now())`, [moldId, companyId, partId]);
      await client.query(`INSERT INTO batch (id, company_id, mold_id, code) VALUES ($1, $2, $3, $4)`, [randomUUID(), companyId, moldId, batchCode]);
      await client.query(
        `INSERT INTO shift (id, company_id, name, start_time, end_time, updated_at) VALUES ($1, $2, 'Todo el día', '00:00', '23:59', now())`,
        [randomUUID(), companyId],
      );
    });
  });

  test.afterEach(async () => {
    await sql(async (client) => {
      const company = `(SELECT company_id FROM "user" WHERE email = $1)`;
      for (const table of ["station", "batch", "mold", "part", "shift"]) {
        await client.query(`DELETE FROM ${table} WHERE company_id = ${company}`, [admin.email]);
      }
      await client.query(`DELETE FROM "user" WHERE role = 'STATION' AND company_id = ${company}`, [admin.email]);
    });
    await deleteAccount(admin);
  });

  test("el Admin crea la estación, le asigna el lote y la cuenta técnica abre su pantalla", { tag: "@regression" }, async ({ page, signInPage }) => {
    const stationEmail = `estacion-${randomUUID().slice(0, 8)}@rikuydeep.test`;

    await signInPage.goto("/panel");
    await signInPage.signIn(admin.email, admin.password);
    await page.getByRole("link", { name: "Estaciones" }).click();
    await expect(page).toHaveURL(/\/panel\/admin\/estaciones$/);

    const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Crear estación" }) });
    await create.getByLabel("Nombre").fill("Estación 1");
    await create.getByLabel("Línea", { exact: true }).fill("Línea A");
    await create.getByLabel("Correo de la cuenta técnica").fill(stationEmail);
    await create.getByLabel("Contraseña de la cuenta técnica").fill("corta");
    await create.getByRole("button", { name: "Crear estación" }).click();
    await expect(create.getByText(/al menos 10 caracteres/)).toBeVisible();
    await expect(create.getByLabel("Contraseña de la cuenta técnica")).toHaveValue("");

    await create.getByLabel("Contraseña de la cuenta técnica").fill(TEST_PASSWORD);
    await create.getByRole("button", { name: "Crear estación" }).click();
    const card = page.getByTestId("estacion").filter({ hasText: "Estación 1" });
    await expect(card).toContainText(stationEmail);

    await card.locator("summary", { hasText: "Lote asignado" }).click();
    await card.getByRole("combobox", { name: "Lote" }).selectOption({ label: `${batchCode} · M-44 · IMP-44` });
    await card.getByRole("button", { name: "Asignar lote" }).click();
    await expect(card.getByText(/Lote asignado\. La estación lo tomará/)).toBeVisible();

    await card.locator("summary", { hasText: "Calibración y parámetros" }).click();
    await card.getByLabel("Foto de 1 de cada N piezas OK").fill("10");
    await card.getByLabel("Fotogramas quietos antes de inspeccionar").fill("0");
    await card.getByRole("button", { name: "Guardar parámetros" }).click();
    await expect(card.getByText("Al menos 1")).toBeVisible();
    await card.getByLabel("Fotogramas quietos antes de inspeccionar").fill("4");
    await card.getByRole("button", { name: "Guardar parámetros" }).click();
    await expect(card.getByText(/Configuración guardada/)).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);

    // El equipo de la línea es otro navegador: basta con salir de la sesión del Admin.
    await page.context().clearCookies();

    // La cuenta técnica entra y ve su estación, no la inspección manual.
    await signInPage.goto("/panel");
    await signInPage.signIn(stationEmail, TEST_PASSWORD);
    await expect(page).toHaveURL(/\/panel$/);
    const nav = page.getByRole("navigation", { name: /panel/i });
    await expect(nav.getByRole("link", { name: "Inspeccionar" })).toHaveCount(0);
    await page.getByRole("link", { name: "Abrir la estación" }).click();
    await expect(page).toHaveURL(/\/panel\/estacion$/);
    await expect(page.getByTestId("estacion-lote")).toContainText(batchCode);
    await expect(page.getByTestId("estacion-turno")).toContainText("Todo el día");
  });

  test("un inspector no puede abrir la estación ni administrarlas", async ({ page, signInPage, account }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);
    for (const path of ["/panel/estacion", "/panel/admin/estaciones"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(403);
    }
  });
});
