import { expect, type Locator, type Page } from "@playwright/test";

/** Page Object de /ingresar (HU19). */
export class SignInPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly submitButton: Locator;
  readonly alert: Locator;

  constructor(readonly page: Page) {
    // exact: otras pantallas montadas en segundo plano tienen «Tu contraseña».
    this.email = page.getByLabel("Correo", { exact: true });
    this.password = page.getByLabel("Contraseña", { exact: true });
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

  /** Segundo paso del login con 2FA (HU29). */
  async completeTwoFactor(code: string, options: { trustDevice?: boolean } = {}) {
    await expect(this.page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
    await this.page.getByRole("textbox", { name: "Código de verificación" }).fill(code);
    if (options.trustDevice) await this.page.getByRole("checkbox", { name: /Confiar en este equipo/ }).check();
    await this.page.getByRole("button", { name: "Verificar" }).click();
  }
}
