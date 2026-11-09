import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integración de HU23 (RIKDP-34) contra Postgres: alta de empresas con la
 * invitación de su administrador, permisos, RUC único, aceptación de la
 * invitación y desactivación de la empresa.
 */
describe.skipIf(!process.env.DATABASE_URL)("gestión de empresas (HU23)", async () => {
  const { getDb } = await import("@/lib/db");
  const { ForbiddenError, setDeniedAccessLogger } = await import("@/lib/authz");
  const { CompanyError, createCompany, getCompany, inviteAdmin, listCompanies, setCompanyStatus, updateCompany } =
    await import("./service");
  const { acceptInvitation, hashInvitationToken, INVITATION_DAYS, InvitationError, previewInvitation } = await import(
    "@/lib/invitations/service"
  );
  const { loadActor } = await import("@/lib/inspections/service");
  type AuthzUser = import("@/lib/authz").AuthzUser;

  const db = getDb();
  const companyIds: string[] = [];
  const emails: string[] = [];
  let superadmin: AuthzUser;
  let plantAdmin: AuthzUser;

  const email = () => {
    const value = `hu23-${randomUUID()}@prueba.test`;
    emails.push(value);
    return value;
  };
  const ruc = () => `2${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

  async function newCompany(overrides: Partial<{ taxId: string | null; adminEmail: string }> = {}) {
    const result = await createCompany(db, superadmin, {
      name: `Fundición ${randomUUID().slice(0, 6)}`,
      taxId: overrides.taxId === undefined ? ruc() : overrides.taxId,
      timezone: "America/Lima",
      adminName: "Rosa Quispe",
      adminEmail: overrides.adminEmail ?? email(),
    });
    companyIds.push(result.company.id);
    return result;
  }

  beforeAll(async () => {
    setDeniedAccessLogger(() => {});
    const sa = await db.user.create({
      data: { id: randomUUID(), name: "Superadmin HU23", email: email(), role: "SUPERADMIN", companyId: null },
    });
    superadmin = { id: sa.id, role: "SUPERADMIN", empresaId: null };
    const { company } = await newCompany();
    const admin = await db.user.create({
      data: { id: randomUUID(), name: "Admin HU23", email: email(), role: "ADMIN", companyId: company.id },
    });
    plantAdmin = { id: admin.id, role: "ADMIN", empresaId: company.id };
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await db.invitation.deleteMany({ where: { companyId: { in: companyIds } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.company.deleteMany({ where: { id: { in: companyIds } } });
  });

  it("crea la empresa activa e invita a su administrador sin guardar el token en claro", async () => {
    const adminEmail = email();
    const { company, invitation, token } = await newCompany({ adminEmail });

    const saved = await db.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(saved.status).toBe("ACTIVE");
    expect(invitation).toMatchObject({ email: adminEmail, role: "ADMIN", companyId: company.id, acceptedAt: null });
    expect(invitation.tokenHash).toBe(hashInvitationToken(token));
    expect(invitation.tokenHash).not.toContain(token);
    const days = (invitation.expiresAt.getTime() - invitation.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(INVITATION_DAYS, 1);
  });

  it("solo el superadministrador gestiona empresas", async () => {
    await expect(listCompanies(db, plantAdmin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCompany(db, plantAdmin, {
        name: "Intrusa",
        taxId: null,
        timezone: "America/Lima",
        adminName: "X",
        adminEmail: email(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCompanyStatus(db, plantAdmin, plantAdmin.empresaId!, "INACTIVE")).rejects.toBeInstanceOf(ForbiddenError);
    const list = await listCompanies(db, superadmin);
    expect(list.some((c) => c.id === plantAdmin.empresaId)).toBe(true);
  });

  it("rechaza un RUC repetido", async () => {
    const taxId = ruc();
    await newCompany({ taxId });
    await expect(newCompany({ taxId })).rejects.toMatchObject({ code: "DUPLICATE_TAX_ID" });
  });

  it("no deja una empresa a medias si el correo del administrador ya tiene cuenta", async () => {
    const taken = email();
    await db.user.create({
      data: { id: randomUUID(), name: "Ya existe", email: taken, role: "VIEWER", companyId: plantAdmin.empresaId },
    });
    const name = `Fundición huérfana ${randomUUID().slice(0, 6)}`;
    await expect(
      createCompany(db, superadmin, { name, taxId: null, timezone: "America/Lima", adminName: "X", adminEmail: taken }),
    ).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
    expect(await db.company.count({ where: { name } })).toBe(0);
  });

  it("edita los datos de la empresa", async () => {
    const { company } = await newCompany();
    await updateCompany(db, superadmin, company.id, { name: "Fundición Renombrada", taxId: null, timezone: "America/Bogota" });
    const detail = await getCompany(db, superadmin, company.id);
    expect(detail).toMatchObject({ name: "Fundición Renombrada", taxId: null, timezone: "America/Bogota" });
    await expect(getCompany(db, superadmin, randomUUID())).rejects.toBeInstanceOf(CompanyError);
  });

  it("al aceptar la invitación crea un administrador de esa empresa, una sola vez", async () => {
    const adminEmail = email();
    const { company, token } = await newCompany({ adminEmail });
    expect(await previewInvitation(db, token)).toMatchObject({ status: "valid", email: adminEmail, role: "ADMIN" });

    const user = await acceptInvitation(db, { token, name: "Rosa Quispe", password: "Fundicion-2026" });
    expect(user).toMatchObject({ email: adminEmail, role: "ADMIN", companyId: company.id, active: true });
    expect(await db.account.count({ where: { userId: user.id, providerId: "credential" } })).toBe(1);

    await expect(acceptInvitation(db, { token, name: "Otra vez", password: "Fundicion-2026" })).rejects.toMatchObject({
      code: "USED",
    });
    expect(await previewInvitation(db, token)).toMatchObject({ status: "used" });
    const detail = await getCompany(db, superadmin, company.id);
    expect(detail.users.map((u) => u.email)).toContain(adminEmail);
  });

  it("dos aceptaciones simultáneas del mismo enlace crean una sola cuenta", async () => {
    const adminEmail = email();
    const { token } = await newCompany({ adminEmail });
    const results = await Promise.allSettled([
      acceptInvitation(db, { token, name: "Uno", password: "Fundicion-2026" }),
      acceptInvitation(db, { token, name: "Dos", password: "Fundicion-2026" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { email: adminEmail } })).toBe(1);
  });

  it("una invitación vencida o desconocida no sirve", async () => {
    const { token } = await newCompany();
    const later = new Date(Date.now() + (INVITATION_DAYS + 1) * 86_400_000);
    expect(await previewInvitation(db, token, later)).toMatchObject({ status: "expired" });
    await expect(acceptInvitation(db, { token, name: "Tarde", password: "Fundicion-2026", now: later })).rejects.toMatchObject({
      code: "EXPIRED",
    });
    expect(await previewInvitation(db, "token-inventado")).toEqual({ status: "invalid" });
    await expect(
      acceptInvitation(db, { token: "token-inventado", name: "X", password: "Fundicion-2026" }),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("reenviar la invitación invalida el enlace anterior", async () => {
    const adminEmail = email();
    const { company, token: first } = await newCompany({ adminEmail });
    const { token: second } = await inviteAdmin(db, superadmin, company.id, { adminName: "Rosa", adminEmail });
    expect(await previewInvitation(db, first)).toMatchObject({ status: "expired" });
    expect(await previewInvitation(db, second)).toMatchObject({ status: "valid" });
  });

  it("desactivar la empresa cierra las sesiones de sus usuarios y le quita el acceso", async () => {
    const adminEmail = email();
    const { company, token } = await newCompany({ adminEmail });
    const pending = await inviteAdmin(db, superadmin, company.id, { adminName: "Segundo", adminEmail: email() });
    const user = await acceptInvitation(db, { token, name: "Rosa", password: "Fundicion-2026" });
    await db.session.create({
      data: { id: randomUUID(), userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    expect(await loadActor(db, user.id)).not.toBeNull();

    const result = await setCompanyStatus(db, superadmin, company.id, "INACTIVE");
    expect(result.revokedSessions).toBe(1);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await loadActor(db, user.id)).toBeNull();

    // Sin acceso nuevo mientras esté desactivada.
    expect(await previewInvitation(db, pending.token)).toMatchObject({ status: "company_inactive" });
    await expect(
      acceptInvitation(db, { token: pending.token, name: "Segundo", password: "Fundicion-2026" }),
    ).rejects.toMatchObject({ code: "COMPANY_INACTIVE" });
    expect(await previewInvitation(db, pending.token)).toMatchObject({ status: "company_inactive" });
    await expect(inviteAdmin(db, superadmin, company.id, { adminName: "X", adminEmail: email() })).rejects.toMatchObject({
      code: "COMPANY_INACTIVE",
    });

    await setCompanyStatus(db, superadmin, company.id, "ACTIVE");
    expect(await loadActor(db, user.id)).not.toBeNull();
  });

  it("registra el intento cuando alguien sin permiso intenta gestionar empresas", async () => {
    const denied = vi.fn();
    setDeniedAccessLogger(denied);
    await expect(listCompanies(db, plantAdmin)).rejects.toBeInstanceOf(ForbiddenError);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ permission: "empresas:gestionar", reason: "SIN_PERMISO" }));
    setDeniedAccessLogger(() => {});
  });
});
