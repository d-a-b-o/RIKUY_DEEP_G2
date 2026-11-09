import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** HU30 · Gestionar usuarios de mi planta (RIKDP-41, RIKDP-171, RIKDP-172, RIKDP-173). */
describe.skipIf(!process.env.DATABASE_URL)("usuarios de planta contra Postgres (HU30)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError, setDeniedAccessLogger } = await import("@/lib/authz");
  const svc = await import("./service");
  const { acceptInvitation, previewInvitation } = await import("@/lib/invitations/service");
  type AuthzUser = import("@/lib/authz").AuthzUser;

  const db = getDb();
  const companies: string[] = [];
  const emails: string[] = [];
  const email = (tag = "u") => {
    const value = `hu30-${tag}-${randomUUID().slice(0, 8)}@prueba.test`;
    emails.push(value);
    return value;
  };

  let admin: AuthzUser;
  let otherAdmin: AuthzUser;
  let inspectorId: string;
  let viewerId: string;
  let secondAdminId: string;
  let otherInspectorId: string;

  async function user(companyId: string, role: "ADMIN" | "INSPECTOR" | "VIEWER", name: string) {
    return db.user.create({ data: { id: randomUUID(), companyId, role, name, email: email(role.toLowerCase()) } });
  }

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    const a = await db.company.create({ data: { name: `HU30 A ${randomUUID()}` } });
    const b = await db.company.create({ data: { name: `HU30 B ${randomUUID()}` } });
    companies.push(a.id, b.id);
    const adminA = await user(a.id, "ADMIN", "Rosa Admin");
    admin = { id: adminA.id, role: "ADMIN", empresaId: a.id };
    secondAdminId = (await user(a.id, "ADMIN", "Otro Admin")).id;
    inspectorId = (await user(a.id, "INSPECTOR", "Ana Inspectora")).id;
    viewerId = (await user(a.id, "VIEWER", "Luis Visor")).id;
    const adminB = await user(b.id, "ADMIN", "Admin B");
    otherAdmin = { id: adminB.id, role: "ADMIN", empresaId: b.id };
    otherInspectorId = (await user(b.id, "INSPECTOR", "Inspector de B")).id;
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { user: { companyId: { in: companies } } } });
    await db.invitation.deleteMany({ where: { companyId: { in: companies } } });
    await db.account.deleteMany({ where: { user: { companyId: { in: companies } } } });
    await db.user.deleteMany({ where: { companyId: { in: companies } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
  });

  const none = svc.userFiltersSchema.parse({});

  it("lista solo los usuarios de la propia empresa (criterios 1 y 3)", async () => {
    const { users } = await svc.listPlantUsers(db, admin, none);
    const ids = users.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([admin.id, secondAdminId, inspectorId, viewerId]));
    expect(ids).not.toContain(otherInspectorId);
    // Solo se editan Inspector y Visualizador, y nunca la propia cuenta.
    expect(users.find((u) => u.id === inspectorId)?.editable).toBe(true);
    expect(users.find((u) => u.id === secondAdminId)?.editable).toBe(false);
    expect(users.find((u) => u.id === admin.id)?.editable).toBe(false);
  });

  it("filtra por texto, rol y estado", async () => {
    const byText = await svc.listPlantUsers(db, admin, svc.userFiltersSchema.parse({ q: "inspectora" }));
    expect(byText.users.map((u) => u.id)).toEqual([inspectorId]);
    const byRole = await svc.listPlantUsers(db, admin, svc.userFiltersSchema.parse({ rol: "VIEWER" }));
    expect(byRole.users.map((u) => u.id)).toEqual([viewerId]);
    const inactive = await svc.listPlantUsers(db, admin, svc.userFiltersSchema.parse({ estado: "inactivos" }));
    expect(inactive.users).toEqual([]);
  });

  it("un admin no ve ni modifica usuarios de otra empresa (criterio 3)", async () => {
    await expect(svc.updatePlantUser(db, otherAdmin, inspectorId, { name: "Hack", role: "VIEWER" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(svc.setPlantUserActive(db, otherAdmin, inspectorId, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.user.findUnique({ where: { id: inspectorId } })).toMatchObject({ name: "Ana Inspectora", active: true });
  });

  it("solo el Admin de planta gestiona usuarios", async () => {
    const inspector: AuthzUser = { id: inspectorId, role: "INSPECTOR", empresaId: admin.empresaId };
    await expect(svc.listPlantUsers(db, inspector, none)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no cambia la propia cuenta ni la de otro admin", async () => {
    await expect(svc.setPlantUserActive(db, admin, admin.id, false)).rejects.toMatchObject({ code: "SELF" });
    await expect(svc.updatePlantUser(db, admin, secondAdminId, { name: "Otro Admin", role: "VIEWER" })).rejects.toMatchObject({
      code: "NOT_EDITABLE",
    });
  });

  it("cambiar el rol cierra las sesiones del usuario", async () => {
    await db.session.create({
      data: { id: randomUUID(), userId: viewerId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const { revokedSessions } = await svc.updatePlantUser(db, admin, viewerId, { name: "Luis Visor", role: "INSPECTOR" });
    expect(revokedSessions).toBe(1);
    expect(await db.user.findUnique({ where: { id: viewerId } })).toMatchObject({ role: "INSPECTOR" });
  });

  it("desactivar cierra todas sus sesiones (criterio 4) y se puede reactivar", async () => {
    for (let i = 0; i < 2; i++) {
      await db.session.create({
        data: { id: randomUUID(), userId: inspectorId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
      });
    }
    const { revokedSessions } = await svc.setPlantUserActive(db, admin, inspectorId, false);
    expect(revokedSessions).toBe(2);
    expect(await db.session.count({ where: { userId: inspectorId } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: inspectorId } })).toMatchObject({ active: false });
    await svc.setPlantUserActive(db, admin, inspectorId, true);
    expect(await db.user.findUnique({ where: { id: inspectorId } })).toMatchObject({ active: true });
  });

  it("invita por correo, el enlace crea la cuenta en la empresa y con el rol elegidos (criterio 2)", async () => {
    const to = email("nuevo");
    const { token, invitation, companyName } = await svc.invitePlantUser(db, admin, { name: "Nuevo Visor", email: to.toUpperCase(), role: "VIEWER" });
    expect(invitation).toMatchObject({ email: to, role: "VIEWER", companyId: admin.empresaId });
    expect(companyName).toMatch(/^HU30 A/);

    const pending = await svc.listPlantUsers(db, admin, none);
    expect(pending.invitations.map((i) => i.email)).toContain(to);
    expect((await svc.listPlantUsers(db, otherAdmin, none)).invitations.map((i) => i.email)).not.toContain(to);

    expect(await previewInvitation(db, token)).toMatchObject({ status: "valid", role: "VIEWER" });
    const created = await acceptInvitation(db, { token, name: "Nuevo Visor", password: "Planta-Andina-2026" });
    expect(await db.user.findUnique({ where: { id: created.id } })).toMatchObject({
      email: to,
      role: "VIEWER",
      companyId: admin.empresaId,
    });
  });

  it("no invita un correo que ya tiene cuenta ni con un rol que no sea de planta", async () => {
    const existing = await db.user.findUniqueOrThrow({ where: { id: inspectorId }, select: { email: true } });
    await expect(svc.invitePlantUser(db, admin, { name: "Repetido", email: existing.email, role: "INSPECTOR" })).rejects.toMatchObject({
      code: "EMAIL_IN_USE",
      fields: { email: expect.any(String) },
    });
    await expect(
      svc.invitePlantUser(db, admin, { name: "Colado", email: email("x"), role: "ADMIN" as "INSPECTOR" }),
    ).rejects.toMatchObject({ code: "INVALID", fields: { role: expect.any(String) } });
  });

  it("anula una invitación pendiente solo en la propia empresa", async () => {
    const { invitation, token } = await svc.invitePlantUser(db, admin, { name: "Para anular", email: email("anular"), role: "INSPECTOR" });
    await expect(svc.revokeInvitation(db, otherAdmin, invitation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await svc.revokeInvitation(db, admin, invitation.id);
    expect(await previewInvitation(db, token)).toMatchObject({ status: "expired" });
  });
});
