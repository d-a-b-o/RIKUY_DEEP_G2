import { expect, type Locator, type Page } from "@playwright/test";

export type DemoRequest = {
  name: string;
  email: string;
  company: string;
  role?: string;
  phone?: string;
  message?: string;
};

/** Page Object de la landing (HU12) y su formulario de demo. */
export class LandingPage {
  readonly heading: Locator;
  readonly demoSection: Locator;
  readonly submitButton: Locator;
  readonly consent: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { level: 1 });
    this.demoSection = page.locator("section#demo");
    this.submitButton = this.demoSection.getByRole("button", { name: "Solicitar demo" });
    this.consent = this.demoSection.getByRole("checkbox");
  }

  async goto() {
    // El filtro anti-spam rechaza envíos hechos menos de 3 s después de cargar
    // la página: el reloj del navegador arranca 10 s antes para no esperar.
    await this.page.clock.install({ time: Date.now() - 10_000 });
    await this.page.goto("/");
    await expect(this.heading).toBeVisible();
  }

  field(label: string): Locator {
    return this.demoSection.getByLabel(label, { exact: false });
  }

  async fillDemoRequest(request: DemoRequest) {
    await this.field("Nombre y apellido").fill(request.name);
    await this.field("Correo de trabajo").fill(request.email);
    await this.field("Empresa").fill(request.company);
    if (request.role) await this.field("Cargo").fill(request.role);
    if (request.phone) await this.field("Teléfono").fill(request.phone);
    if (request.message) await this.field("¿Qué piezas inspeccionan?").fill(request.message);
    await this.consent.check();
  }

  async submit() {
    await this.submitButton.click();
  }
}
