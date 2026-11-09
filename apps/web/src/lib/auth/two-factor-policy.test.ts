import { describe, expect, it } from "vitest";
import { isTwoFactorRequired, mustSetUpTwoFactor } from "./two-factor-policy";

describe("política de 2FA (HU29, criterio 3)", () => {
  const optional = { requireTwoFactor: false };
  const required = { requireTwoFactor: true };

  it("el superadministrador siempre la tiene obligatoria", () => {
    expect(isTwoFactorRequired({ role: "SUPERADMIN", company: null })).toBe(true);
  });

  it.each(["ADMIN", "INSPECTOR", "VIEWER"])("%s depende de la política de su empresa", (role) => {
    expect(isTwoFactorRequired({ role, company: optional })).toBe(false);
    expect(isTwoFactorRequired({ role, company: required })).toBe(true);
  });

  it("las cuentas técnicas de estación quedan fuera aunque la empresa la exija", () => {
    expect(isTwoFactorRequired({ role: "STATION", company: required })).toBe(false);
  });

  it("solo obliga a configurarla a quien la necesita y no la tiene", () => {
    expect(mustSetUpTwoFactor({ role: "SUPERADMIN", company: null, twoFactorEnabled: false })).toBe(true);
    expect(mustSetUpTwoFactor({ role: "SUPERADMIN", company: null, twoFactorEnabled: true })).toBe(false);
    expect(mustSetUpTwoFactor({ role: "INSPECTOR", company: optional, twoFactorEnabled: false })).toBe(false);
  });
});
