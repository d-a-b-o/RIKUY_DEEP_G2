import { describe, expect, it } from "vitest";

// Prueba de RIKDP-69: falla a propósito para comprobar que el CI bloquea la PR.
// Esta rama no debe fusionarse.
describe("prueba de bloqueo del CI", () => {
  it("falla intencionalmente", () => {
    expect(1 + 1).toBe(3);
  });
});
