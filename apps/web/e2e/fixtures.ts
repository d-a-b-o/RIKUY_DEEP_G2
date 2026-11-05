import { test as base } from "@playwright/test";
import { createAccount, deleteAccount, type TestAccount } from "./support/accounts";
import { LandingPage } from "./pages/landing-page";
import { SignInPage } from "./pages/sign-in-page";

type Fixtures = {
  landingPage: LandingPage;
  signInPage: SignInPage;
  /** Usuario inspector con su propia empresa; se borra al terminar la prueba. */
  account: TestAccount;
};

/** Test con los Page Objects y los datos del proyecto como fixtures. */
export const test = base.extend<Fixtures>({
  page: async ({ page }, provide) => {
    // Cada prueba entra desde una IP distinta para no compartir el rate limit de /api/auth.
    const octet = () => Math.floor(Math.random() * 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
    await provide(page);
  },
  landingPage: async ({ page }, provide) => {
    await provide(new LandingPage(page));
  },
  signInPage: async ({ page }, provide) => {
    await provide(new SignInPage(page));
  },
  account: async ({}, provide) => {
    const account = await createAccount();
    await provide(account);
    await deleteAccount(account);
  },
});

export { expect } from "@playwright/test";
