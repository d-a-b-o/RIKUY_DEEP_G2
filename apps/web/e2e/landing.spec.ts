import { expect, test } from "./fixtures";

/**
 * Prueba de humo de la landing (HU16 · RIKDP-122).
 * Se ejecuta en cada PR: si falla, la aplicación desplegada no sirve.
 */
test.describe("Landing", { tag: "@smoke" }, () => {
  test("carga con su propuesta de valor y la llamada a la demo", async ({ landingPage, page }) => {
    await landingPage.goto();

    await expect(page).toHaveTitle(/RikuyDeep/);
    await expect(landingPage.heading).toContainText("Inspecciona el 100");
    await expect(page.getByRole("banner").getByRole("navigation")).toBeAttached();
    await expect(landingPage.demoSection.getByRole("heading", { level: 2 })).toBeVisible();

    await page.getByRole("link", { name: "Solicitar demo" }).first().click();
    await expect(page).toHaveURL(/#demo$/);
    await expect(landingPage.field("Nombre y apellido")).toBeInViewport();
  });

  test("el formulario de demo marca los campos obligatorios", async ({ landingPage }) => {
    await landingPage.goto();
    await landingPage.submit();

    await expect(landingPage.demoSection.getByText("Revisa los campos marcados")).toBeVisible();
    await expect(landingPage.field("Nombre y apellido")).toHaveAttribute("aria-invalid", "true");
    await expect(landingPage.field("Correo de trabajo")).toHaveAttribute("aria-invalid", "true");
    await expect(landingPage.consent).toHaveAttribute("aria-invalid", "true");
  });

  test("una solicitud válida llega al servidor", async ({ landingPage, page }) => {
    await landingPage.goto();

    await landingPage.fillDemoRequest({
      name: "Prueba de humo",
      email: `smoke-${Date.now()}@rikuydeep.test`,
      company: "Fundiciones de prueba",
      message: "Generado por la prueba de humo de Playwright.",
    });
    await landingPage.submit();

    // Con base de datos se guarda el lead; sin ella, el sitio avisa de que el
    // envío no está activo. Ambas respuestas prueban que el servidor validó la
    // solicitud: un rechazo por spam o un error harían fallar la prueba.
    const sent = page.getByRole("status").getByText("Recibimos tu solicitud");
    const unavailable = landingPage.demoSection.getByText("el envío de solicitudes todavía no está activo");
    await expect(sent.or(unavailable)).toBeVisible();

    if (process.env.E2E_EXPECT_DATABASE === "1") {
      await expect(sent).toBeVisible();
    }
  });
});
