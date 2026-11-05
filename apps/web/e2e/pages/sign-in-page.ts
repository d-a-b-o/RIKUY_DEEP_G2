import { expect, type Locator, type Page } from "@playwright/test";

/** Page Object de /ingresar (HU19). */
export class SignInPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly submitButton: Locator;
  readonly alert: Locator;

  constructor(readonly page: Page) {
    this.email = page.getByLabel("Correo");
    this.password = page.getByLabel("Contraseña");
    this.submitButton = page.getByRole("button", { name: "Ingresar" });
    // Dentro de main: Next añade su propio role="alert" para anunciar navegaciones.
    this.alert = page.getByRole("main").getByRole("alert");
  }

  async goto(next?: string) {
    await this.page.goto(next ? `/ingresar?next=${encodeURIComponent(next)}` : "/ingresar");
    await expect(this.page.getByRole("heading", { level: 1, name: "Ingresar" })).toBeVisible();
  }

  async signIn(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submitButton.click();
  }
}
