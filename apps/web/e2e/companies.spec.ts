import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { SignInPage } from "./pages/sign-in-page";
import {
  createSuperadmin,
  deleteAccount,
  deleteCompanyByName,
  hasDatabase,
  type TestAccount,
} from "./support/accounts";

/**
 * Gestión de empresas por el superadministrador (HU23, RIKDP-34): alta con la
 * invitación del administrador, aceptación y desactivación de la empresa.
 * Sin Resend configurado, la pantalla muestra el enlace para copiarlo.
 */
async function signInAs(page: Page, email: string, password: string) {
  const signIn = new SignInPage(page);
  await expect(signIn.email).toBeVisible();
  await signIn.signIn(email, password);
}

test.skip(!hasDatabase(), "Necesita DATABASE_URL para crear usuarios de prueba.");

test.describe("Empresas (superadministrador)", () => {
  let superadmin: TestAccount;
  const companyName = `Fundición E2E ${randomUUID().slice(0, 8)}`;
  const adminEmail = `e2e-admin-${randomUUID().slice(0, 8)}@rikuydeep.test`;

  test.beforeEach(async () => {
    superadmin = await createSuperadmin();
  });

  test.afterEach(async () => {
    await deleteCompanyByName(companyName);
    await deleteAccount(superadmin);
  });

  test(
    "crea la empresa, el administrador acepta la invitación y la desactivación le quita el acceso",
    { tag: "@smoke" },
    async ({ page, signInPage, browser }) => {
      await signInPage.goto("/panel/admin/empresas");
      await signInPage.signIn(superadmin.email, superadmin.password);
      await expect(page).toHaveURL(/\/panel\/admin\/empresas$/);
      await expect(page.getByRole("link", { name: "Inspeccionar" })).toHaveCount(0);

      await page.getByRole("link", { name: "Nueva empresa" }).click();
      const datos = page.getByRole("group", { name: "Datos de la empresa" });
      const administrador = page.getByRole("group", { name: "Administrador de la planta" });
      await datos.getByRole("textbox", { name: "Nombre" }).fill(companyName);
      await datos.getByRole("textbox", { name: /RUC/ }).fill("2012345678");
      await administrador.getByRole("textbox", { name: "Nombre" }).fill("Rosa Quispe");
      await administrador.getByRole("textbox", { name: "Correo" }).fill(adminEmail);
      await page.getByRole("button", { name: "Crear empresa e invitar" }).click();
      await expect(page.getByText("El RUC tiene 11 dígitos")).toBeVisible();

      await datos.getByRole("textbox", { name: /RUC/ }).fill("");
      await page.getByRole("button", { name: "Crear empresa e invitar" }).click();
      const result = page.getByRole("main").getByRole("status");
      await expect(result).toContainText(`Invitación creada para ${adminEmail}`);
      const inviteUrl = await page.getByRole("textbox", { name: /Copia el enlace/ }).inputValue();
      expect(inviteUrl).toContain("/invitacion?token=");

      // El administrador acepta la invitación en otro navegador.
      const adminContext = await browser.newContext();
      const admin = await adminContext.newPage();
      await admin.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).search);
      await expect(admin.getByRole("main").getByText(companyName)).toBeVisible();
      await admin.getByRole("textbox", { name: "Tu nombre" }).fill("Rosa Quispe");
      await admin.getByLabel("Contraseña", { exact: true }).fill("Planta-Andina-2026");
      await admin.getByLabel("Repite la contraseña").fill("Planta-Andina-2026");
      await admin.getByRole("button", { name: "Crear mi cuenta" }).click();
      await expect(admin.getByText("Cuenta creada")).toBeVisible();

      await admin.getByRole("link", { name: "Ir a ingresar" }).click();
      await signInAs(admin, adminEmail, "Planta-Andina-2026");
      await expect(admin).toHaveURL(/\/panel$/);
      const panel = admin.locator("#contenido-panel");
      await expect(panel.getByText("Administrador de planta")).toBeVisible();
      await expect(panel.getByText(companyName)).toBeVisible();
      await expect(admin.getByRole("link", { name: "Empresas" })).toHaveCount(0);

      // El enlace ya no sirve.
      await admin.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).search);
      await expect(admin.getByRole("main").getByRole("alert")).toContainText("ya se usó");

      // El superadministrador desactiva la empresa: el administrador pierde la sesión.
      await page.getByRole("link", { name: "Ver la empresa" }).click();
      await expect(page.getByRole("heading", { level: 1, name: companyName })).toBeVisible();
      await expect(page.getByText(adminEmail).first()).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Desactivar empresa" }).click();
      await expect(page.getByText(/Empresa desactivada\. Se cerraron 1 sesiones/)).toBeVisible();

      await admin.goto("/panel");
      await expect(admin).toHaveURL(/\/ingresar/);
      await signInAs(admin, adminEmail, "Planta-Andina-2026");
      await expect(admin.getByRole("main").getByRole("alert")).toHaveText("El correo o la contraseña no son correctos.");
      await adminContext.close();
    },
  );
});

test("un usuario de planta no puede entrar a la gestión de empresas", { tag: "@regression" }, async ({
  page,
  signInPage,
  account,
}) => {
  await signInPage.goto("/panel/admin/empresas");
  await signInPage.signIn(account.email, account.password);
  await expect(page).toHaveURL(/\/panel\/admin\/empresas$/);
  await expect(page.getByRole("heading", { name: "Esta sección no está disponible para tu rol" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Empresas" })).toHaveCount(0);
});

test.describe("Empresas: responsive y accesibilidad", () => {
  let superadmin: TestAccount;
  const companyName = `Fundición Responsive ${randomUUID().slice(0, 8)}`;

  test.beforeEach(async () => {
    superadmin = await createSuperadmin();
  });

  test.afterEach(async () => {
    await deleteCompanyByName(companyName);
    await deleteAccount(superadmin);
  });

  test("las pantallas de empresas no tienen scroll horizontal ni fallos de accesibilidad", { tag: "@regression" }, async ({
    page,
    signInPage,
  }) => {
    await signInPage.goto("/panel/admin/empresas/nueva");
    await signInPage.signIn(superadmin.email, superadmin.password);
    await expect(page).toHaveURL(/\/nueva$/);
    const datos = page.getByRole("group", { name: "Datos de la empresa" });
    const administrador = page.getByRole("group", { name: "Administrador de la planta" });
    await datos.getByRole("textbox", { name: "Nombre" }).fill(companyName);
    await administrador.getByRole("textbox", { name: "Nombre" }).fill("Rosa Quispe");
    await administrador
      .getByRole("textbox", { name: "Correo" })
      .fill(`e2e-resp-${randomUUID().slice(0, 8)}@rikuydeep.test`);
    await page.getByRole("button", { name: "Crear empresa e invitar" }).click();
    await page.getByRole("link", { name: "Ver la empresa" }).click();
    await expect(page.getByRole("heading", { level: 1, name: companyName })).toBeVisible();
    const detail = new URL(page.url()).pathname;

    for (const route of ["/panel/admin/empresas", "/panel/admin/empresas/nueva", detail]) {
      for (const width of [360, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
