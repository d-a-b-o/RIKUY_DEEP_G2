import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { expect, test } from "./fixtures";
import { createSuperadmin, deleteAccount, hasDatabase, type TestAccount } from "./support/accounts";
import { totpFromBase32 } from "./support/totp";

/**
 * Verificación en dos pasos (HU29, RIKDP-40): activación con QR y primer
 * código, login en dos pasos, código de respaldo y 2FA obligatoria. Los casos
 * formales siguen en PT4.
 */
test.skip(!hasDatabase(), "Necesita DATABASE_URL para crear usuarios de prueba.");

/** Siguiente código TOTP distinto del anterior, para no reutilizar uno ya aceptado. */
async function freshCode(key: string, previous?: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const code = await totpFromBase32(key);
    if (code !== previous) return code;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("No cambió el código TOTP");
}

test(
  "activa la 2FA con el QR, entra con el código y con un código de respaldo",
  { tag: "@smoke" },
  async ({ page, signInPage, account }) => {
    test.setTimeout(90_000);
    await signInPage.goto("/panel/cuenta/seguridad");
    await signInPage.signIn(account.email, account.password);
    await expect(page).toHaveURL(/\/panel\/cuenta\/seguridad$/);

    await page.getByRole("textbox", { name: "Tu contraseña" }).fill(account.password);
    await page.getByRole("button", { name: "Activar la verificación en dos pasos" }).click();
    await expect(page.getByRole("img", { name: "Código QR para la app autenticadora" })).toBeVisible();
    const key = (await page.getByTestId("clave-totp").innerText()).trim();
    const first = await freshCode(key);
    await page.getByRole("textbox", { name: "Código de la app" }).fill(first);
    await page.getByRole("button", { name: "Activar", exact: true }).click();

    await expect(page.getByText("Verificación en dos pasos activada")).toBeVisible();
    const codes = await page.getByRole("list", { name: "Códigos de respaldo" }).getByRole("listitem").allInnerTexts();
    expect(codes).toHaveLength(10);
    await page.getByRole("button", { name: "Ya los guardé" }).click();
    await expect(page.getByText(/^Activada/)).toBeVisible();

    // La contraseña sola ya no basta.
    await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
    await expect(page).toHaveURL(/\/ingresar/);
    await signInPage.signIn(account.email, account.password);
    await signInPage.completeTwoFactor("000000");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("El código no es correcto");
    await page.getByRole("textbox", { name: "Código de verificación" }).fill(await freshCode(key, first));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/panel$/);

    // Con un código de respaldo, que luego deja de servir.
    await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
    await signInPage.signIn(account.email, account.password);
    await page.getByRole("button", { name: "Usar un código de respaldo" }).click();
    await page.getByRole("textbox", { name: "Código de respaldo" }).fill(codes[0]);
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
    await signInPage.signIn(account.email, account.password);
    await page.getByRole("button", { name: "Usar un código de respaldo" }).click();
    await page.getByRole("textbox", { name: "Código de respaldo" }).fill(codes[0]);
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("no es válido o ya se usó");
  },
);

test.describe("2FA obligatoria", () => {
  let superadmin: TestAccount;

  test.beforeEach(async () => {
    superadmin = await createSuperadmin();
    // Un superadmin que todavía no la configuró.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `DELETE FROM two_factor WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
        [superadmin.email],
      );
      await client.query(`UPDATE "user" SET two_factor_enabled = false WHERE email = $1`, [superadmin.email]);
    } finally {
      await client.end();
    }
  });

  test.afterEach(async () => {
    await deleteAccount(superadmin);
  });

  test("el superadministrador sin 2FA solo puede entrar a configurarla", { tag: "@regression" }, async ({
    page,
    signInPage,
  }) => {
    await signInPage.goto("/panel/admin/empresas");
    await signInPage.signIn(superadmin.email, superadmin.password);
    await expect(page).toHaveURL(/\/panel\/cuenta\/seguridad$/);
    await expect(page.getByText("Tu cuenta debe usar la verificación en dos pasos")).toBeVisible();
    await expect(page.getByRole("link", { name: "Empresas" })).toHaveCount(0);

    await page.goto("/panel/admin/empresas");
    await expect(page).toHaveURL(/\/panel\/cuenta\/seguridad$/);

    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px`).toBe(true);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);

    // Tras activarla ya puede gestionar empresas, y no ve el botón para desactivarla.
    await page.getByRole("textbox", { name: "Tu contraseña" }).fill(superadmin.password);
    await page.getByRole("button", { name: "Activar la verificación en dos pasos" }).click();
    const key = (await page.getByTestId("clave-totp").innerText()).trim();
    await page.getByRole("textbox", { name: "Código de la app" }).fill(await totpFromBase32(key));
    await page.getByRole("button", { name: "Activar", exact: true }).click();
    await page.getByRole("button", { name: "Ya los guardé" }).click();
    await expect(page.getByText("Activada · obligatoria para tu cuenta")).toBeVisible();
    await expect(page.getByRole("button", { name: /Desactivar/ })).toHaveCount(0);
    await page.goto("/panel/admin/empresas");
    await expect(page).toHaveURL(/\/panel\/admin\/empresas$/);
  });
});

test("el administrador de planta puede exigir 2FA a toda su empresa", { tag: "@regression" }, async ({
  page,
  signInPage,
}) => {
  const { createAccount, enableTwoFactor } = await import("./support/accounts");
  const admin = await createAccount("ADMIN");
  try {
    const { totpSecret } = await enableTwoFactor(admin.email);
    const { totpCode } = await import("./support/totp");
    await signInPage.goto("/panel/cuenta/seguridad");
    await signInPage.signIn(admin.email, admin.password);
    await signInPage.completeTwoFactor(await totpCode(totpSecret));
    await expect(page).toHaveURL(/\/panel\/cuenta\/seguridad$/);

    await page.getByRole("button", { name: "Exigir a toda la planta" }).click();
    await expect(page.getByText(/todas las personas de tu planta deberán activar/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dejar de exigirla" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Desactivar/ })).toHaveCount(0);
  } finally {
    await deleteAccount(admin);
  }
});

