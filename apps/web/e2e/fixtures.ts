import { test as base } from "@playwright/test";
import { LandingPage } from "./pages/landing-page";

type Fixtures = {
  landingPage: LandingPage;
};

/** Test con los Page Objects del proyecto como fixtures. */
export const test = base.extend<Fixtures>({
  landingPage: async ({ page }, provide) => {
    await provide(new LandingPage(page));
  },
});

export { expect } from "@playwright/test";
