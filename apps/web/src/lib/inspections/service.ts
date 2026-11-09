import "server-only";
import { mustSetUpTwoFactor } from "@/lib/auth/two-factor-policy";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createImageReadUrl, imageExists, isImageKeyOfCompany, isStorageConfigured } from "@/lib/storage/r2";
import { canCorrect, canReadTrace, canRecord, findActiveShift, isImageRequired, type Role, type Verdict } from "./rules";
import {
  correctVerdictSchema,
  isPlausibleCaptureTime,
  recordInspectionSchema,
  type CorrectVerdictInput,
  type RecordInspectionInput,
} from "./schema";

/**
 * Trazabilidad de inspecciones (HU24, RIKDP-35).
 *
 * - Cada inspección se inserta una sola vez junto con su evento CREATED, en la
 *   misma transacción (ADR 0004). La base de datos impide editarla o borrarla.
 * - El contexto (empresa, autor, molde y pieza) lo deduce el servidor; del
 *   navegador solo se acepta lo que el navegador sabe: el resultado del modelo.
 * - Las correcciones son eventos nuevos (CORRECTED + FLAGGED_FOR_RETRAINING).
 */

export type InspectionErrorCode =
  | "FORBIDDEN"
  | "INVALID"
  | "NOT_FOUND"
  | "BATCH_CLOSED"
  | "NO_ACTIVE_SHIFT"
  | "UNKNOWN_MODEL"
  | "IMAGE_REQUIRED"
  | "IMAGE_NOT_FOUND"
  | "STORAGE_NOT_CONFIGURED"
  | "CONFLICT";

export class InspectionError extends Error {
  constructor(
    readonly code: InspectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InspectionError";
  }
}

/** Usuario que actúa, con su empresa y, si es una cuenta técnica, su estación. */
export type Actor = {
  userId: string;
  role: Role;
  companyId: string | null;
  stationId: string | null;
};

export type ServiceDeps = {
  db: PrismaClient;
  /** Comprueba en R2 que la foto existe. Inyectable para las pruebas. */
  imageExists?: (key: string) => Promise<boolean>;
  storageConfigured?: () => boolean;
  now?: () => Date;
};

/** Carga el actor de la sesión. Devuelve null si el usuario no existe o él o su empresa están desactivados. */
export async function loadActor(db: PrismaClient, userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      companyId: true,
      active: true,
      twoFactorEnabled: true,
      company: { select: { status: true, requireTwoFactor: true } },
      station: { select: { id: true, active: true } },
    },
  });
  // Una empresa desactivada no registra ni consulta inspecciones (HU23, criterio 3).
  if (!user?.active || user.company?.status === "INACTIVE") return null;
  // Obligada a usar 2FA y sin activarla todavía (HU29, criterio 3).
  if (mustSetUpTwoFactor(user)) return null;
  return {
    userId: user.id,
    role: user.role,
    companyId: user.companyId,
    stationId: user.station?.active ? user.station.id : null,
  };
}

function requireCompany(actor: Actor): string {
  if (!actor.companyId) throw new InspectionError("FORBIDDEN", "Tu cuenta no pertenece a ninguna empresa");
  return actor.companyId;
}

function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): InspectionError {
  const detail = error.issues.map((issue) => `${issue.path.join(".") || "datos"}: ${issue.message}`).join("; ");
  return new InspectionError("INVALID", `Datos de la inspección no válidos (${detail})`);
}

const toDecimal = (value: number) => new Prisma.Decimal(value.toFixed(4));

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// ─── Registrar ─────────────────────────────────────────────────────────────

export type RecordedInspection = { id: string; duplicate: boolean };

export async function recordInspection(
  deps: ServiceDeps,
  actor: Actor,
  input: RecordInspectionInput,
): Promise<RecordedInspection> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();

  const parsed = recordInspectionSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const data = parsed.data;

  // Autor (reglas 8 y 10).
  const companyId = requireCompany(actor);
  if (!canRecord(actor.role, data.source)) {
    throw new InspectionError("FORBIDDEN", "Tu rol no puede registrar este tipo de inspección");
  }
  if (actor.role === "STATION" && !actor.stationId) {
    throw new InspectionError("FORBIDDEN", "La cuenta técnica no tiene una estación activa");
  }
  if (data.pieceNumber !== undefined && data.source !== "LINE") {
    throw new InspectionError("INVALID", "El número de pieza solo lo envía una estación");
  }
  if (!isPlausibleCaptureTime(data.capturedAt, now)) {
    throw new InspectionError("INVALID", "La hora de captura no es válida");
  }

  // Reintento de un registro ya guardado (sincronización sin red): idempotente.
  if (data.clientId) {
    const existing = await db.inspection.findUnique({ where: { id: data.clientId }, select: { companyId: true } });
    if (existing) {
      if (existing.companyId !== companyId) throw new InspectionError("CONFLICT", "Identificador de inspección en uso");
      return { id: data.clientId, duplicate: true };
    }
  }

  // Contexto, siempre dentro de la empresa del actor (reglas 2 y 6).
  const [batch, company, modelVersion] = await Promise.all([
    db.batch.findFirst({
      where: { id: data.batchId, companyId },
      select: { id: true, status: true, moldId: true, mold: { select: { partId: true } } },
    }),
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }),
    db.modelVersion.findUnique({ where: { version: data.modelVersion }, select: { id: true } }),
  ]);
  if (!batch) throw new InspectionError("NOT_FOUND", "El lote no existe en tu empresa");
  if (batch.status !== "OPEN") throw new InspectionError("BATCH_CLOSED", "El lote está cerrado");
  if (!modelVersion) throw new InspectionError("UNKNOWN_MODEL", `La versión de modelo ${data.modelVersion} no está registrada`);

  const shifts = await db.shift.findMany({
    where: { companyId, active: true, ...(data.shiftId ? { id: data.shiftId } : {}) },
    select: { id: true, startTime: true, endTime: true },
  });
  let shiftId: string;
  if (data.shiftId) {
    if (shifts.length === 0) throw new InspectionError("NOT_FOUND", "El turno no existe en tu empresa");
    shiftId = data.shiftId;
  } else {
    const active = findActiveShift(shifts, data.capturedAt, company.timezone);
    if (!active) throw new InspectionError("NO_ACTIVE_SHIFT", "Ningún turno cubre la hora de captura");
    shiftId = active.id;
  }

  // Foto (regla 9; ADR 0005, paso 4).
  const imageRequired = isImageRequired(data.source, data.predictedVerdict);
  if (imageRequired && !data.imageKey) {
    throw new InspectionError("IMAGE_REQUIRED", "Esta inspección debe guardar la foto");
  }
  if (data.imageKey) {
    if (!isImageKeyOfCompany(data.imageKey, companyId)) {
      throw new InspectionError("FORBIDDEN", "La clave de la imagen no pertenece a tu empresa");
    }
    if (!(deps.storageConfigured ?? isStorageConfigured)()) {
      throw new InspectionError("STORAGE_NOT_CONFIGURED", "El almacenamiento de imágenes no está configurado");
    }
    const exists = await (deps.imageExists ?? imageExists)(data.imageKey);
    if (!exists) throw new InspectionError("IMAGE_NOT_FOUND", "La foto no se subió a R2");
  }

  const isStation = actor.role === "STATION";
  try {
    const created = await db.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          ...(data.clientId ? { id: data.clientId } : {}),
          companyId,
          batchId: batch.id,
          shiftId,
          moldId: batch.moldId,
          partId: batch.mold.partId,
          inspectorId: isStation ? null : actor.userId,
          stationId: isStation ? actor.stationId : null,
          pieceNumber: data.pieceNumber ?? null,
          modelVersionId: modelVersion.id,
          source: data.source,
          predictedVerdict: data.predictedVerdict,
          currentVerdict: data.predictedVerdict,
          confidence: toDecimal(data.confidence),
          thresholdApplied: toDecimal(data.thresholdApplied),
          imageKey: data.imageKey ?? null,
          imageSha256: data.imageSha256 ?? null,
          inferenceMs: data.inferenceMs ?? null,
          backend: data.backend ?? null,
          warnings: data.warnings,
          capturedAt: data.capturedAt,
        },
        select: { id: true },
      });
      await tx.inspectionEvent.create({
        data: {
          companyId,
          inspectionId: inspection.id,
          type: "CREATED",
          newVerdict: data.predictedVerdict,
          actorId: actor.userId,
        },
      });
      return inspection;
    });
    return { id: created.id, duplicate: false };
  } catch (error) {
    // Dos reintentos simultáneos con el mismo clientId: el segundo es un duplicado.
    if (data.clientId && isUniqueViolation(error)) return { id: data.clientId, duplicate: true };
    throw error;
  }
}

// ─── Corregir (ADR 0004, regla 4) ──────────────────────────────────────────

export async function correctVerdict(
  deps: ServiceDeps,
  actor: Actor,
  input: CorrectVerdictInput,
): Promise<{ id: string; currentVerdict: Verdict }> {
  const { db } = deps;
  const parsed = correctVerdictSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const { inspectionId, newVerdict, reason } = parsed.data;

  const companyId = requireCompany(actor);
  if (!canCorrect(actor.role)) throw new InspectionError("FORBIDDEN", "Tu rol no puede corregir veredictos");

  const inspection = await db.inspection.findFirst({
    where: { id: inspectionId, companyId },
    select: { id: true, currentVerdict: true },
  });
  if (!inspection) throw new InspectionError("NOT_FOUND", "La inspección no existe en tu empresa");
  if (inspection.currentVerdict === newVerdict) {
    throw new InspectionError("INVALID", "El veredicto nuevo es igual al vigente");
  }

  const correctedAt = deps.now?.() ?? new Date();
  await db.$transaction(async (tx) => {
    // Solo actualiza si nadie lo corrigió entre la lectura y ahora.
    const updated = await tx.inspection.updateMany({
      where: { id: inspectionId, companyId, currentVerdict: inspection.currentVerdict },
      data: { currentVerdict: newVerdict, correctedAt },
    });
    if (updated.count !== 1) throw new InspectionError("CONFLICT", "Otra persona corrigió esta inspección; recarga");

    await tx.inspectionEvent.create({
      data: {
        companyId,
        inspectionId,
        type: "CORRECTED",
        previousVerdict: inspection.currentVerdict,
        newVerdict,
        reason,
        actorId: actor.userId,
      },
    });
    await tx.inspectionEvent.create({
      data: { companyId, inspectionId, type: "FLAGGED_FOR_RETRAINING", reason, actorId: actor.userId },
    });
  });

  return { id: inspectionId, currentVerdict: newVerdict };
}

// ─── Consultar la trazabilidad ─────────────────────────────────────────────

export async function getInspectionTrace(deps: ServiceDeps, actor: Actor, inspectionId: string) {
  const { db } = deps;
  const companyId = requireCompany(actor);
  if (!canReadTrace(actor.role)) throw new InspectionError("FORBIDDEN", "Tu rol no puede consultar inspecciones");

  const inspection = await db.inspection.findFirst({
    where: { id: inspectionId, companyId },
    include: {
      batch: { select: { code: true } },
      shift: { select: { name: true } },
      mold: { select: { code: true } },
      part: { select: { code: true, name: true } },
      inspector: { select: { name: true } },
      station: { select: { name: true, line: true } },
      modelVersion: { select: { version: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          type: true,
          previousVerdict: true,
          newVerdict: true,
          reason: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
    },
  });
  if (!inspection) throw new InspectionError("NOT_FOUND", "La inspección no existe en tu empresa");

  const storageReady = (deps.storageConfigured ?? isStorageConfigured)();
  return {
    ...inspection,
    imageUrl: inspection.imageKey && storageReady ? createImageReadUrl(inspection.imageKey) : null,
  };
}
