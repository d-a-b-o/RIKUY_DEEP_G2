import { expect, test } from "./fixtures";
import { createAccount, deleteAccount, hasDatabase, type TestAccount } from "./support/accounts";

/**
 * HU32 · Acceder según mi rol (RIKDP-43), criterios 2 y 3: el proxy corta con
 * 403 antes de renderizar y el intento queda en el registro de accesos
 * denegados, que el Admin de planta consulta en /panel/admin/auditoria.
 */
test.describe("Acceso según el rol (HU32)", () => {
  test.skip(!hasDatabase(), "Necesita DATABASE_URL");

  test("una ruta fuera del rol responde 403 con el aviso", { tag: "@regression" }, async ({
    page,
    signInPage,
    account,
  }) => {
    await signInPage.goto("/panel");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);

    const response = await page.goto("/panel/admin/empresas");
    expect(response?.status()).toBe(403);
    await expect(page).toHaveURL(/\/panel\/admin\/empresas$/);
    await expect(page.getByRole("heading", { name: "Esta sección no está disponible para tu rol" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Auditoría" })).toHaveCount(0);
  });

  test.describe("registro de accesos denegados", () => {
    let admin: TestAccount;

    test.beforeEach(async () => {
      admin = await createAccount("ADMIN");
    });

    test.afterEach(async () => {
      await deleteAccount(admin);
    });

    test("el Admin de planta ve sus propios intentos denegados", { tag: "@regression" }, async ({
      page,
      signInPage,
    }) => {
      await signInPage.goto("/panel");
      await signInPage.signIn(admin.email, admin.password);
      await expect(page).toHaveURL(/\/panel$/);

      // El Admin de planta no gestiona empresas: eso es del Superadmin.
      expect((await page.goto("/panel/admin/empresas"))?.status()).toBe(403);

      await page.goto("/panel");
      await page.getByRole("link", { name: "Auditoría" }).click();
      await expect(page).toHaveURL(/\/panel\/admin\/auditoria$/);
      const row = page.getByRole("row").filter({ hasText: "/panel/admin/empresas" });
      await expect(row).toContainText(admin.email);
      await expect(row).toContainText("Su rol no tiene el permiso");
    });
  });
});
