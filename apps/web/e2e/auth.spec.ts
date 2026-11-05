import { expect, test } from "./fixtures";
import { hasDatabase } from "./support/accounts";

/**
 * Inicio de sesión y recuperación de contraseña (HU19).
 * Los casos formales completos son RIKDP-136 y RIKDP-139 (PT4).
 */
test.skip(!hasDatabase(), "Necesita DATABASE_URL para crear usuarios de prueba.");

test.describe("Inicio de sesión", () => {
  test("entra al panel, muestra al usuario y cierra la sesión", { tag: "@smoke" }, async ({ signInPage, account, page }) => {
    await page.goto("/panel");
    await expect(page).toHaveURL(/\/ingresar\?next=%2Fpanel$/);

    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Hola, ${account.name}`);
    await expect(page.getByText(account.companyName)).toBeVisible();
    await expect(page.getByText("Inspector de calidad")).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/ingresar$/);
    await page.goto("/panel");
    await expect(page).toHaveURL(/\/ingresar\?next=/);
  });

  test("con la contraseña incorrecta avisa sin entrar", { tag: "@smoke" }, async ({ signInPage, account, page }) => {
    await signInPage.goto();
    await signInPage.signIn(account.email, "no-es-la-clave");
    await expect(signInPage.alert).toHaveText("El correo o la contraseña no son correctos.");
    await expect(page).toHaveURL(/\/ingresar$/);
  });

  test("bloquea la cuenta tras 5 intentos fallidos", { tag: "@regression" }, async ({ signInPage, account }) => {
    await signInPage.goto();
    for (let attempt = 1; attempt <= 4; attempt++) {
      await signInPage.signIn(account.email, `mal-${attempt}`);
      await expect(signInPage.alert).toHaveText("El correo o la contraseña no son correctos.");
    }
    await signInPage.signIn(account.email, "mal-5");
    await expect(signInPage.alert).toContainText("bloqueada temporalmente");

    await signInPage.signIn(account.email, account.password);
    await expect(signInPage.alert).toContainText("bloqueada temporalmente");
  });

  test("no redirige fuera del sitio con ?next=", { tag: "@regression" }, async ({ signInPage, account, page }) => {
    await signInPage.goto("https://ejemplo.com/robar");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel$/);
  });
});

test.describe("Recuperación de contraseña", () => {
  test("responde lo mismo exista o no la cuenta", { tag: "@regression" }, async ({ account, page }) => {
    for (const email of [account.email, "nadie@rikuydeep.test"]) {
      await page.goto("/ingresar");
      await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
      await expect(page).toHaveURL(/\/recuperar$/);
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Enviar enlace" }).click();
      await expect(page.getByRole("status")).toContainText("Revisa tu correo");
      await expect(page.getByRole("status")).toContainText("Vence en 30 minutos");
    }
  });

  test("un enlace sin token o inválido no deja cambiar la contraseña", { tag: "@regression" }, async ({ page }) => {
    await page.goto("/restablecer");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("no es válido");

    await page.goto("/restablecer?token=token-falso");
    await page.getByLabel("Nueva contraseña").fill("Nueva-clave-2026");
    await page.getByLabel("Repite la contraseña").fill("Nueva-clave-2026");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Pide uno nuevo");
  });
});
