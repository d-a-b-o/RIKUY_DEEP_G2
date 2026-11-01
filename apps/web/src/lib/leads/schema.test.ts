import { describe, expect, it } from "vitest";
import { demoRequestSchema, looksLikeSpam, MIN_FILL_TIME_MS } from "./schema";

const valid = {
  name: "Carlos Quispe",
  email: "  Carlos.Quispe@Fundiciones-Andinas.pe ",
  company: "Fundiciones Andinas",
  role: "Jefe de calidad",
  phone: "+51 987 654 321",
  message: "Fabricamos impulsores de bomba.",
  consent: "on",
};

describe("demoRequestSchema", () => {
  it("acepta una solicitud completa y normaliza el correo", () => {
    const result = demoRequestSchema.parse(valid);
    expect(result.email).toBe("carlos.quispe@fundiciones-andinas.pe");
    expect(result.name).toBe("Carlos Quispe");
  });

  it("acepta los campos opcionales vacíos y los deja sin definir", () => {
    const result = demoRequestSchema.parse({ ...valid, role: "", phone: "", message: "" });
    expect(result.role).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it.each([
    ["nombre vacío", { name: " " }, "name"],
    ["correo inválido", { email: "carlos@" }, "email"],
    ["empresa vacía", { company: "" }, "company"],
    ["teléfono con letras", { phone: "llámame" }, "phone"],
    ["mensaje demasiado largo", { message: "x".repeat(1001) }, "message"],
    ["sin autorización de contacto", { consent: undefined }, "consent"],
  ])("rechaza %s", (_name, override, field) => {
    const result = demoRequestSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });
});

describe("looksLikeSpam", () => {
  const now = 1_800_000_000_000;

  it("deja pasar a una persona que tardó más del mínimo", () => {
    expect(looksLikeSpam({ honeypot: "", startedAt: String(now - MIN_FILL_TIME_MS - 1), now })).toBe(false);
  });

  it("detecta el campo trampa relleno", () => {
    expect(looksLikeSpam({ honeypot: "https://spam.example", startedAt: String(now - 60_000), now })).toBe(true);
  });

  it("detecta un envío demasiado rápido", () => {
    expect(looksLikeSpam({ honeypot: "", startedAt: String(now - 500), now })).toBe(true);
  });

  it("detecta una marca de tiempo ausente o inválida", () => {
    expect(looksLikeSpam({ honeypot: null, startedAt: null, now })).toBe(true);
    expect(looksLikeSpam({ honeypot: null, startedAt: "abc", now })).toBe(true);
  });

  it("detecta un formulario abierto hace más de un día", () => {
    expect(looksLikeSpam({ honeypot: "", startedAt: String(now - 2 * 24 * 60 * 60 * 1000), now })).toBe(true);
  });
});
