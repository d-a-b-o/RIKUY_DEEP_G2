"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/authz";
import { getActionUser } from "@/lib/auth/session";
import { sendInvitationEmail } from "@/lib/auth/emails";
import {
  adminInviteSchema,
  companySchema,
  fieldErrors,
  newCompanySchema,
  type CompanyField,
} from "@/lib/companies/schema";
import { CompanyError, createCompany, inviteAdmin, setCompanyStatus, updateCompany } from "@/lib/companies/service";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { INVITATION_DAYS } from "@/lib/invitations/service";
import { getSiteUrl } from "@/lib/site";

/**
 * Server Actions de la gestión de empresas (HU23). Cada una vuelve a comprobar
 * la sesión y el permiso en el servidor (src/lib/companies/service.ts).
 */

export type CompanyFormValues = Partial<Record<CompanyField, string>>;

export type CompanyFormState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<CompanyField, string>>; values: CompanyFormValues }
  | { status: "error"; message: string; values: CompanyFormValues }
  | { status: "saved"; message: string }
  | {
      status: "invited";
      companyId: string;
      companyName: string;
      email: string;
      emailSent: boolean;
      /** Solo si el correo no salió: el superadministrador puede copiarlo y enviarlo él. */
      inviteUrl?: string;
    };

const FIELDS: CompanyField[] = ["name", "taxId", "timezone", "adminName", "adminEmail"];

function readValues(formData: FormData): CompanyFormValues {
  const values: CompanyFormValues = {};
  for (const field of FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.slice(0, 300);
  }
  return values;
}

function invitationUrl(token: string): string {
  const url = new URL("/invitacion", getSiteUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

async function requireUser() {
  if (!isDatabaseConfigured()) throw new CompanyError("NOT_FOUND", "La base de datos no está configurada");
  const user = await getActionUser();
  if (!user) throw new ForbiddenError("empresas:gestionar", "NO_AUTENTICADO");
  return user;
}

function failure(error: unknown, values: CompanyFormValues): CompanyFormState {
  if (error instanceof ForbiddenError) {
    return { status: "error", message: "Tu rol no puede gestionar empresas.", values };
  }
  if (error instanceof CompanyError) {
    if (error.code === "DUPLICATE_TAX_ID") {
      return { status: "invalid", errors: { taxId: error.message }, values };
    }
    if (error.code === "EMAIL_IN_USE") {
      return { status: "invalid", errors: { adminEmail: error.message }, values };
    }
    return { status: "error", message: error.message, values };
  }
  console.error("[empresas] error inesperado", error);
  return { status: "error", message: "No se pudo guardar. Inténtalo de nuevo en unos minutos.", values };
}

async function sendInvitation(input: {
  companyId: string;
  companyName: string;
  email: string;
  name: string;
  token: string;
}): Promise<CompanyFormState> {
  const url = invitationUrl(input.token);
  const emailSent = await sendInvitationEmail({
    to: input.email,
    name: input.name,
    companyName: input.companyName,
    url,
    days: INVITATION_DAYS,
  });
  return {
    status: "invited",
    companyId: input.companyId,
    companyName: input.companyName,
    email: input.email,
    emailSent,
    inviteUrl: emailSent ? undefined : url,
  };
}

/** Alta de empresa con la invitación a su primer administrador (criterios 1 y 2). */
export async function createCompanyAction(_previous: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  const values = readValues(formData);
  const parsed = newCompanySchema.safeParse(values);
  if (!parsed.success) return { status: "invalid", errors: fieldErrors<CompanyField>(parsed.error), values };

  try {
    const actor = await requireUser();
    const { company, token } = await createCompany(getDb(), actor, parsed.data);
    revalidatePath("/panel/admin/empresas");
    return sendInvitation({
      companyId: company.id,
      companyName: company.name,
      email: parsed.data.adminEmail,
      name: parsed.data.adminName,
      token,
    });
  } catch (error) {
    return failure(error, values);
  }
}

/** Edición de los datos de la empresa. */
export async function updateCompanyAction(_previous: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  const values = readValues(formData);
  const id = String(formData.get("companyId") ?? "");
  const parsed = companySchema.safeParse(values);
  if (!parsed.success) return { status: "invalid", errors: fieldErrors<CompanyField>(parsed.error), values };

  try {
    const actor = await requireUser();
    await updateCompany(getDb(), actor, id, parsed.data);
    revalidatePath("/panel/admin/empresas");
    revalidatePath(`/panel/admin/empresas/${id}`);
    return { status: "saved", message: "Cambios guardados." };
  } catch (error) {
    return failure(error, values);
  }
}

/** Invita a otro administrador o reenvía la invitación. */
export async function inviteAdminAction(_previous: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  const values = readValues(formData);
  const id = String(formData.get("companyId") ?? "");
  const parsed = adminInviteSchema.safeParse(values);
  if (!parsed.success) return { status: "invalid", errors: fieldErrors<CompanyField>(parsed.error), values };

  try {
    const actor = await requireUser();
    const { company, token } = await inviteAdmin(getDb(), actor, id, parsed.data);
    revalidatePath(`/panel/admin/empresas/${id}`);
    return sendInvitation({
      companyId: company.id,
      companyName: company.name,
      email: parsed.data.adminEmail,
      name: parsed.data.adminName,
      token,
    });
  } catch (error) {
    return failure(error, values);
  }
}

export type StatusState = { status: "idle" } | { status: "error"; message: string } | { status: "saved"; message: string };

/** Activa o desactiva la empresa (criterio 3). */
export async function setCompanyStatusAction(_previous: StatusState, formData: FormData): Promise<StatusState> {
  const id = String(formData.get("companyId") ?? "");
  const next = formData.get("status") === "ACTIVE" ? "ACTIVE" : "INACTIVE";
  try {
    const actor = await requireUser();
    const result = await setCompanyStatus(getDb(), actor, id, next);
    revalidatePath("/panel/admin/empresas");
    revalidatePath(`/panel/admin/empresas/${id}`);
    return {
      status: "saved",
      message:
        next === "ACTIVE"
          ? "Empresa activada. Sus usuarios ya pueden iniciar sesión."
          : `Empresa desactivada. Se cerraron ${result.revokedSessions} sesiones abiertas.`,
    };
  } catch (error) {
    const state = failure(error, {});
    return { status: "error", message: state.status === "error" ? state.message : "No se pudo cambiar el estado." };
  }
}
