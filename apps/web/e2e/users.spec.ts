import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createAccount, deleteAccount, hasDatabase, type TestAccount } from "./support/accounts";

/**
 * HU30 · Gestionar usuarios de mi planta (RIKDP-41). Sin RESEND_API_KEY el
 * correo no sale y la pantalla ofrece el enlace para copiarlo, que es el que
 * usa la prueba.
 */
test.describe("Usuarios de planta (HU30)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  let admin: TestAccount;

  test.beforeEach(async () => {
    admin = await createAccount("ADMIN");
  });

  test.afterEach(async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const company = `(SELECT company_id FROM "user" WHERE email = $1)`;
    await client.query(`DELETE FROM invitation WHERE company_id = ${company}`, [admin.email]);
    await client.query(`DELETE FROM "user" WHERE company_id = ${company} AND email <> $1`, [admin.email]);
    await client.end();
    await deleteAccount(admin);
  });

  test("invita a un inspector, crea su cuenta con el enlace y el admin lo desactiva", { tag: "@regression" }, async ({
    page,
    signInPage,
    browser,
  }) => {
    const email = `e2e-hu30-${randomUUID().slice(0, 8)}@rikuydeep.test`;
    await signInPage.goto("/panel");
    await signInPage.signIn(admin.email, admin.password);
    await page.getByRole("link", { name: "Usuarios" }).click();
    await expect(page).toHaveURL(/\/panel\/admin\/usuarios$/);

    const invite = page.getByRole("region", { name: "Invitar a un usuario" });
    await invite.getByLabel("Nombre", { exact: true }).fill("Ana Mamani");
    await invite.getByLabel("Correo", { exact: true }).fill(email);
    await invite.getByLabel("Rol", { exact: true }).selectOption("INSPECTOR");
    await invite.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(invite.getByRole("status")).toContainText(email);
    const link = await invite.getByLabel(/Copia el enlace/).inputValue();
    await expect(page.getByText(`${email} · Inspector`)).toBeVisible();

    // La persona invitada crea su cuenta en otro navegador.
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(link);
    await guestPage.getByLabel("Tu nombre").fill("Ana Mamani");
    await guestPage.getByLabel("Contraseña", { exact: true }).fill("Planta-Andina-2026");
    await guestPage.getByLabel("Repite la contraseña").fill("Planta-Andina-2026");
    await expect(guestPage.locator("p", { hasText: "Rol:" })).toContainText("Rol: Inspector");
    await guestPage.getByRole("button", { name: "Crear mi cuenta" }).click();
    await expect(guestPage.getByText("Cuenta creada")).toBeVisible();
    await guestPage.goto("/ingresar?next=/panel");
    await guestPage.getByLabel("Correo").fill(email);
    await guestPage.getByLabel("Contraseña", { exact: true }).fill("Planta-Andina-2026");
    await guestPage.getByRole("button", { name: "Ingresar" }).click();
    await expect(guestPage).toHaveURL(/\/panel$/);
    await expect(guestPage.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: "Inspeccionar" })).toBeVisible();
    await expect(guestPage.getByRole("link", { name: "Usuarios" })).toHaveCount(0);

    // El admin la ve en la lista y la desactiva: su sesión deja de valer.
    await page.reload();
    const card = page.getByRole("listitem").filter({ hasText: email });
    await expect(card).toContainText("Inspector");
    await card.getByText("Editar o desactivar").click();
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Desactivar a Ana Mamani" }).click();
    await expect(card).toContainText("Inactivo");

    await guestPage.goto("/panel");
    await expect(guestPage).toHaveURL(/\/ingresar/);
    await guest.close();

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px`).toBe(true);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  });

  test("un Inspector no entra a la gestión de usuarios", { tag: "@regression" }, async ({ page, signInPage, account }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);
    expect((await page.goto("/panel/admin/usuarios"))?.status()).toBe(403);
  });
});
