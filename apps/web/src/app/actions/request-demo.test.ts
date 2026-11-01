import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestDemo, type DemoRequestState } from "./request-demo";

const idle: DemoRequestState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const human = () => ({ website: "", startedAt: String(Date.now() - 10_000) });

const validFields = (email: string) => ({
  ...human(),
  name: "Carlos Quispe",
  email,
  company: "Fundiciones Andinas",
  role: "Jefe de calidad",
  phone: "",
  message: "Impulsores de aluminio",
  consent: "on",
});

describe("requestDemo sin base de datos", () => {
  const original = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (original) process.env.DATABASE_URL = original;
  });

  it("valida pero no da por recibida la solicitud", async () => {
    const state = await requestDemo(idle, form(validFields("carlos@fundiciones.pe")));
    expect(state.status).toBe("unavailable");
  });

  it("devuelve los errores por campo y conserva lo escrito", async () => {
    const state = await requestDemo(idle, form({ ...human(), name: "Carlos", email: "no-es-correo" }));
    expect(state.status).toBe("invalid");
    if (state.status !== "invalid") return;
    expect(state.errors.email).toBeDefined();
    expect(state.errors.company).toBeDefined();
    expect(state.errors.consent).toBeDefined();
    expect(state.values.name).toBe("Carlos");
  });

  it("rechaza un envío que parece automático", async () => {
    const state = await requestDemo(idle, form({ ...validFields("bot@spam.test"), website: "https://spam.test" }));
    expect(state.status).toBe("rejected");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("requestDemo con base de datos", () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const email = `prueba-${Date.now()}@fundiciones.test`;

  afterAll(async () => {
    await client.query("DELETE FROM lead WHERE email = $1", [email]);
    await client.end();
  });

  it("guarda el lead y confirma la solicitud", async () => {
    await client.connect();
    const state = await requestDemo(idle, form(validFields(email)));
    expect(state.status).toBe("sent");
    const { rows } = await client.query(
      "SELECT name, company_name, role, phone, message, status, consented_at FROM lead WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Carlos Quispe",
      company_name: "Fundiciones Andinas",
      role: "Jefe de calidad",
      phone: null,
      status: "NEW",
    });
    expect(rows[0].consented_at).toBeInstanceOf(Date);
  });

  it("no guarda nada si la solicitud es inválida", async () => {
    const before = await client.query("SELECT count(*)::int AS n FROM lead");
    await requestDemo(idle, form({ ...human(), name: "X" }));
    const after = await client.query("SELECT count(*)::int AS n FROM lead");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
