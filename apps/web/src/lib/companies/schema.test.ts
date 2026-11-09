import { describe, expect, it } from "vitest";
import { acceptInvitationSchema, companySchema, fieldErrors, newCompanySchema } from "./schema";

describe("formulario de empresa (HU23)", () => {
  const valid = { name: "Fundición Andina", taxId: "20123456789", timezone: "America/Lima" };

  it("acepta una empresa válida y normaliza el RUC vacío a null", () => {
    expect(companySchema.parse(valid)).toEqual(valid);
    expect(companySchema.parse({ ...valid, taxId: "  " }).taxId).toBeNull();
    expect(companySchema.parse({ name: "Planta 2", timezone: "America/Lima" }).taxId).toBeNull();
  });

  it.each([
    [{ name: "A" }, "name"],
    [{ taxId: "2012345678" }, "taxId"],
    [{ taxId: "2012345678X" }, "taxId"],
    [{ timezone: "Europe/Madrid" }, "timezone"],
  ])("rechaza %o en el campo %s", (override, field) => {
    const result = companySchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toHaveProperty(field);
  });

  it("el alta exige nombre y correo del administrador, y normaliza el correo", () => {
    const parsed = newCompanySchema.parse({ ...valid, adminName: "Rosa Quispe", adminEmail: "  Rosa@Andina.PE " });
    expect(parsed.adminEmail).toBe("rosa@andina.pe");
    const result = newCompanySchema.safeParse({ ...valid, adminName: "", adminEmail: "no-es-correo" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrors(result.error)).sort()).toEqual(["adminEmail", "adminName"]);
  });
});

describe("aceptar invitación (HU23-T02)", () => {
  const schema = acceptInvitationSchema({ min: 10, max: 128 });

  it("exige contraseña larga y confirmada", () => {
    expect(schema.safeParse({ name: "Rosa", password: "Fundicion-2026", confirm: "Fundicion-2026" }).success).toBe(true);
    const short = schema.safeParse({ name: "Rosa", password: "corta", confirm: "corta" });
    expect(short.success).toBe(false);
    const mismatch = schema.safeParse({ name: "Rosa", password: "Fundicion-2026", confirm: "Fundicion-2027" });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(fieldErrors(mismatch.error)).toHaveProperty("confirm");
  });
});
