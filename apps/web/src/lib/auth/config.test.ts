import { describe, expect, it } from "vitest";
import { AFTER_SIGN_IN_PATH, authErrorMessage, safeNextPath } from "./config";

describe("safeNextPath", () => {
  it("acepta rutas internas", () => {
    expect(safeNextPath("/panel/historial?lote=L-0417")).toBe("/panel/historial?lote=L-0417");
  });

  it.each([null, undefined, "", "https://otro.sitio", "//otro.sitio", "/\\otro.sitio", "javascript:alert(1)"])(
    "manda %s al panel",
    (next) => {
      expect(safeNextPath(next)).toBe(AFTER_SIGN_IN_PATH);
    },
  );
});

describe("authErrorMessage", () => {
  it("distingue la cuenta bloqueada de la contraseña incorrecta", () => {
    expect(authErrorMessage({ code: "ACCOUNT_LOCKED", status: 401 }, "sign-in")).toMatch(/bloqueada/);
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "sign-in")).toMatch(/no son correctos/);
  });

  it("el rate limit tiene prioridad sobre el código", () => {
    expect(authErrorMessage({ status: 429 }, "sign-in")).toMatch(/demasiados intentos/);
  });

  it("un enlace inválido pide uno nuevo", () => {
    expect(authErrorMessage({ code: "INVALID_TOKEN", status: 400 }, "reset")).toMatch(/Pide uno nuevo/);
  });

  it("un error desconocido da un mensaje genérico según el flujo", () => {
    expect(authErrorMessage(null, "sign-in")).toMatch(/iniciar sesión/);
    expect(authErrorMessage({ code: "OTRO" }, "reset")).toMatch(/cambiar la contraseña/);
  });
});
