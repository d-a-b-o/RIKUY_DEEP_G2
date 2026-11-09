import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";
import { findActiveShift } from "@/lib/inspections/rules";
import { timeOfDay } from "@/lib/reports/shift-report";
import {
  batchSchema,
  fieldErrors,
  moldSchema,
  partSchema,
  shiftSchema,
  shiftsOverlap,
  toTime,
  type BatchInput,
  type MoldInput,
  type PartInput,
  type ShiftInput,
} from "./schema";

/**
 * HU31 · Catálogos de piezas, moldes, lotes y turnos (RIKDP-42) y
 * HU33 · Lotes de producción y turnos (RIKDP-44).
 *
 * Todo se filtra por la empresa del usuario (criterio 3 de HU31): los ids que
 * llegan del navegador se buscan siempre junto con `companyId`, así que un id
 * de otra empresa da NOT_FOUND. Consultar exige `catalogos:ver`; modificar,
 * `catalogos:gestionar` (solo Admin de planta).
 */

export type CatalogErrorCode = "INVALID" | "NOT_FOUND" | "DUPLICATE" | "HAS_INSPECTIONS" | "OVERLAP";

export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

function companyOf(actor: AuthzUser): string {
  if (!actor.empresaId) throw new CatalogError("NOT_FOUND", "Tu cuenta no pertenece a ninguna empresa");
  return actor.empresaId;
}

async function canManage(actor: AuthzUser, action: string): Promise<string> {
  await authorize(actor, "catalogos:gestionar", { empresaId: actor.empresaId, path: action });
  return companyOf(actor);
}

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: import("zod").ZodError } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new CatalogError("INVALID", "Revisa los campos marcados", fieldErrors(result.error));
  return result.data;
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function uniqueOr<T>(work: Promise<T>, field: string, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isUnique(error)) throw new CatalogError("DUPLICATE", message, { [field]: message });
    throw error;
  }
}

// ─── Consulta ───────────────────────────────────────────────────────────────

export const BATCH_LIST_SIZE = 100;

export async function listCatalogs(db: PrismaClient, actor: AuthzUser, now: Date = new Date()) {
  await authorize(actor, "catalogos:ver", { empresaId: actor.empresaId, path: "listCatalogs" });
  const companyId = companyOf(actor);

  const [company, parts, batches, shifts] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
    db.part.findMany({
      where: { companyId },
      orderBy: [{ active: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        active: true,
        molds: { orderBy: { code: "asc" }, select: { id: true, code: true, cavities: true, active: true } },
      },
    }),
    db.batch.findMany({
      where: { companyId },
      orderBy: [{ status: "asc" }, { openedAt: "desc" }],
      take: BATCH_LIST_SIZE,
      select: {
        id: true,
        code: true,
        status: true,
        openedAt: true,
        closedAt: true,
        mold: { select: { code: true, part: { select: { code: true } } } },
        _count: { select: { inspections: true } },
      },
    }),
    db.shift.findMany({
      where: { companyId },
      orderBy: [{ active: "desc" }, { startTime: "asc" }],
      select: { id: true, name: true, startTime: true, endTime: true, active: true },
    }),
  ]);

  const timeZone = company?.timezone ?? "America/Lima";
  const active = findActiveShift(
    shifts.filter((s) => s.active),
    now,
    timeZone,
  );
  return {
    timeZone,
    parts,
    batches: batches.map((b) => ({ ...b, inspections: b._count.inspections })),
    shifts: shifts.map((s) => ({
      id: s.id,
      name: s.name,
      start: timeOfDay(s.startTime),
      end: timeOfDay(s.endTime),
      active: s.active,
      crossesMidnight: s.endTime.getTime() <= s.startTime.getTime(),
    })),
    activeShiftId: active?.id ?? null,
  };
}

export type Catalogs = Awaited<ReturnType<typeof listCatalogs>>;

// ─── Piezas ─────────────────────────────────────────────────────────────────

export async function createPart(db: PrismaClient, actor: AuthzUser, input: PartInput) {
  const companyId = await canManage(actor, "createPart");
  const data = parse(partSchema, input);
  return uniqueOr(db.part.create({ data: { ...data, companyId } }), "code", "Ya existe una pieza con ese código");
}

export async function updatePart(db: PrismaClient, actor: AuthzUser, id: string, input: PartInput) {
  const companyId = await canManage(actor, "updatePart");
  const data = parse(partSchema, input);
  const updated = await uniqueOr(
    db.part.updateMany({ where: { id, companyId }, data }),
    "code",
    "Ya existe una pieza con ese código",
  );
  if (updated.count === 0) throw new CatalogError("NOT_FOUND", "La pieza no existe en tu empresa");
}

/** Desactivar en lugar de borrar: las inspecciones guardan la pieza (ADR 0004). */
export async function setPartActive(db: PrismaClient, actor: AuthzUser, id: string, active: boolean) {
  const companyId = await canManage(actor, "setPartActive");
  const updated = await db.part.updateMany({ where: { id, companyId }, data: { active } });
  if (updated.count === 0) throw new CatalogError("NOT_FOUND", "La pieza no existe en tu empresa");
}

// ─── Moldes ─────────────────────────────────────────────────────────────────

export async function createMold(db: PrismaClient, actor: AuthzUser, input: MoldInput) {
  const companyId = await canManage(actor, "createMold");
  const data = parse(moldSchema, input);
  const part = await db.part.findFirst({ where: { id: data.partId, companyId }, select: { id: true } });
  if (!part) throw new CatalogError("NOT_FOUND", "La pieza no existe en tu empresa", { partId: "Elige una pieza de tu planta" });
  return uniqueOr(db.mold.create({ data: { ...data, companyId } }), "code", "Ya existe un molde con ese código");
}

export async function setMoldActive(db: PrismaClient, actor: AuthzUser, id: string, active: boolean) {
  const companyId = await canManage(actor, "setMoldActive");
  const updated = await db.mold.updateMany({ where: { id, companyId }, data: { active } });
  if (updated.count === 0) throw new CatalogError("NOT_FOUND", "El molde no existe en tu empresa");
}

// ─── Lotes (HU33-T01) ───────────────────────────────────────────────────────

export async function createBatch(db: PrismaClient, actor: AuthzUser, input: BatchInput) {
  const companyId = await canManage(actor, "createBatch");
  const data = parse(batchSchema, input);
  const mold = await db.mold.findFirst({ where: { id: data.moldId, companyId, active: true }, select: { id: true } });
  if (!mold) throw new CatalogError("NOT_FOUND", "El molde no existe o está inactivo", { moldId: "Elige un molde activo de tu planta" });
  return uniqueOr(
    db.batch.create({ data: { ...data, companyId, openedById: actor.id } }),
    "code",
    "Ya existe un lote con ese código",
  );
}

export async function setBatchStatus(db: PrismaClient, actor: AuthzUser, id: string, status: "OPEN" | "CLOSED", now = new Date()) {
  const companyId = await canManage(actor, "setBatchStatus");
  const updated = await db.batch.updateMany({
    where: { id, companyId },
    data: { status, closedAt: status === "CLOSED" ? now : null },
  });
  if (updated.count === 0) throw new CatalogError("NOT_FOUND", "El lote no existe en tu empresa");
}

/** HU33, criterio 3: un lote con inspecciones no se elimina (se cierra). */
export async function deleteBatch(db: PrismaClient, actor: AuthzUser, id: string) {
  const companyId = await canManage(actor, "deleteBatch");
  const batch = await db.batch.findFirst({
    where: { id, companyId },
    select: { id: true, _count: { select: { inspections: true } } },
  });
  if (!batch) throw new CatalogError("NOT_FOUND", "El lote no existe en tu empresa");
  if (batch._count.inspections > 0) {
    throw new CatalogError("HAS_INSPECTIONS", "No se puede eliminar un lote con inspecciones. Ciérralo en su lugar.");
  }
  try {
    await db.batch.delete({ where: { id: batch.id } });
  } catch (error) {
    // Una inspección pudo registrarse entre la comprobación y el borrado: la clave foránea lo impide.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2014")) {
      throw new CatalogError("HAS_INSPECTIONS", "No se puede eliminar un lote con inspecciones. Ciérralo en su lugar.");
    }
    throw error;
  }
}

// ─── Turnos (HU33-T02) ──────────────────────────────────────────────────────

async function assertNoOverlap(db: PrismaClient, companyId: string, shift: { startTime: string; endTime: string }, exceptId?: string) {
  const others = await db.shift.findMany({
    where: { companyId, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true, startTime: true, endTime: true },
  });
  const clash = others.find((o) => shiftsOverlap(shift, { startTime: timeOfDay(o.startTime), endTime: timeOfDay(o.endTime) }));
  if (clash) {
    const message = `Se superpone con el turno «${clash.name}» (${timeOfDay(clash.startTime)}–${timeOfDay(clash.endTime)}). Así no se sabría cuál es el turno activo.`;
    throw new CatalogError("OVERLAP", message, { startTime: message });
  }
}

export async function createShift(db: PrismaClient, actor: AuthzUser, input: ShiftInput) {
  const companyId = await canManage(actor, "createShift");
  const data = parse(shiftSchema, input);
  await assertNoOverlap(db, companyId, data);
  return uniqueOr(
    db.shift.create({ data: { companyId, name: data.name, startTime: toTime(data.startTime), endTime: toTime(data.endTime) } }),
    "name",
    "Ya existe un turno con ese nombre",
  );
}

export async function updateShift(db: PrismaClient, actor: AuthzUser, id: string, input: ShiftInput) {
  const companyId = await canManage(actor, "updateShift");
  const data = parse(shiftSchema, input);
  const current = await db.shift.findFirst({ where: { id, companyId }, select: { active: true } });
  if (!current) throw new CatalogError("NOT_FOUND", "El turno no existe en tu empresa");
  if (current.active) await assertNoOverlap(db, companyId, data, id);
  await uniqueOr(
    db.shift.update({ where: { id }, data: { name: data.name, startTime: toTime(data.startTime), endTime: toTime(data.endTime) } }),
    "name",
    "Ya existe un turno con ese nombre",
  );
}

export async function setShiftActive(db: PrismaClient, actor: AuthzUser, id: string, active: boolean) {
  const companyId = await canManage(actor, "setShiftActive");
  const shift = await db.shift.findFirst({ where: { id, companyId }, select: { startTime: true, endTime: true } });
  if (!shift) throw new CatalogError("NOT_FOUND", "El turno no existe en tu empresa");
  if (active) await assertNoOverlap(db, companyId, { startTime: timeOfDay(shift.startTime), endTime: timeOfDay(shift.endTime) }, id);
  await db.shift.update({ where: { id }, data: { active } });
}
