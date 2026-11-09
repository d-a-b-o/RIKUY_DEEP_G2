import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { authorize, type AuthzUser } from "@/lib/authz";
import { createCredentialUser } from "@/lib/auth/users";
import { findActiveShift } from "@/lib/inspections/rules";
import { InspectionError, recordInspection, type Actor, type ServiceDeps } from "@/lib/inspections/service";
import { parseStationConfig, stationConfigSchema, type StationConfig } from "./config";
import type { SyncItemResult, SyncPayload } from "./queue";

/**
 * HU44 · Estación de inspección automática (RIKDP-55), lado del servidor.
 *
 * - La cuenta técnica de la estación lee su contexto: lote asignado, turno
 *   activo por el reloj, configuración y numeración (criterio 1).
 * - Envía sus inspecciones en lotes; cada una pasa por recordInspection, que
 *   aplica las reglas de HU24 y es idempotente por `clientId` (criterio 5).
 * - El Admin de planta crea las estaciones con su cuenta técnica, asigna el
 *   lote y guarda la calibración (HU44-T04). Todo se filtra por su empresa.
 */

export type StationErrorCode = "INVALID" | "NOT_FOUND" | "DUPLICATE" | "EMAIL_IN_USE" | "BATCH_CLOSED";

export class StationError extends Error {
  constructor(
    readonly code: StationErrorCode,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "StationError";
  }
}

export const SYNC_MAX_ITEMS = 50;

// ─── Contexto de la estación (criterio 1) ─────────────────────────────────────

export type StationContextData = {
  station: { id: string; name: string; line: string };
  batch: { id: string; code: string; moldCode: string; partCode: string; partName: string } | null;
  shift: { id: string; name: string } | null;
  config: StationConfig;
  lastPieceNumber: number;
  /** Inspecciones de esta estación en el turno activo. */
  shiftCounts: { total: number; ok: number; defective: number };
  timeZone: string;
};

const minutesOf = (time: Date) => time.getUTCHours() * 60 + time.getUTCMinutes();

/** Duración del turno en minutos; si cruza la medianoche, termina al día siguiente. */
function shiftMinutes(shift: { startTime: Date; endTime: Date }): number {
  const length = minutesOf(shift.endTime) - minutesOf(shift.startTime);
  return length > 0 ? length : length + 24 * 60;
}

export async function loadStationContext(db: PrismaClient, actor: Actor, now = new Date()): Promise<StationContextData> {
  if (actor.role !== "STATION" || !actor.stationId || !actor.companyId) {
    throw new InspectionError("FORBIDDEN", "Esta pantalla es solo para la cuenta técnica de una estación activa");
  }
  const [station, company, shifts] = await Promise.all([
    db.station.findFirstOrThrow({
      where: { id: actor.stationId, companyId: actor.companyId },
      select: {
        id: true,
        name: true,
        line: true,
        config: true,
        currentBatch: {
          select: {
            id: true,
            code: true,
            status: true,
            mold: { select: { code: true, part: { select: { code: true, name: true } } } },
          },
        },
      },
    }),
    db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } }),
    db.shift.findMany({
      where: { companyId: actor.companyId, active: true },
      select: { id: true, name: true, startTime: true, endTime: true },
    }),
  ]);

  const batch = station.currentBatch?.status === "OPEN" ? station.currentBatch : null;
  const shift = findActiveShift(shifts, now, company.timezone);

  const [last, counts] = await Promise.all([
    batch
      ? db.inspection.aggregate({ where: { stationId: station.id, batchId: batch.id }, _max: { pieceNumber: true } })
      : null,
    shift
      ? db.inspection.groupBy({
          by: ["currentVerdict"],
          where: {
            companyId: actor.companyId,
            stationId: station.id,
            shiftId: shift.id,
            capturedAt: { gte: new Date(now.getTime() - shiftMinutes(shift) * 60_000) },
          },
          _count: { _all: true },
        })
      : [],
  ]);
  const ok = counts.find((c) => c.currentVerdict === "OK")?._count._all ?? 0;
  const defective = counts.find((c) => c.currentVerdict === "DEFECTIVE")?._count._all ?? 0;

  await db.station.update({ where: { id: station.id }, data: { lastSeenAt: now } });

  return {
    station: { id: station.id, name: station.name, line: station.line },
    batch: batch
      ? {
          id: batch.id,
          code: batch.code,
          moldCode: batch.mold.code,
          partCode: batch.mold.part.code,
          partName: batch.mold.part.name,
        }
      : null,
    shift: shift ? { id: shift.id, name: shift.name } : null,
    config: parseStationConfig(station.config),
    lastPieceNumber: last?._max.pieceNumber ?? 0,
    shiftCounts: { total: ok + defective, ok, defective },
    timeZone: company.timezone,
  };
}

// ─── Envío por lotes (criterio 5) ─────────────────────────────────────────────

/**
 * Registra un lote de inspecciones de la estación. Devuelve el resultado de
 * cada una para que el navegador quite de su cola las que ya quedaron guardadas.
 */
export async function syncStationInspections(
  deps: ServiceDeps,
  actor: Actor,
  items: readonly SyncPayload[],
): Promise<SyncItemResult[]> {
  if (actor.role !== "STATION" || !actor.stationId) {
    throw new InspectionError("FORBIDDEN", "Solo una estación activa envía inspecciones de línea");
  }
  if (!Array.isArray(items) || items.length > SYNC_MAX_ITEMS) {
    throw new InspectionError("INVALID", `Envía como máximo ${SYNC_MAX_ITEMS} inspecciones por lote`);
  }
  const results: SyncItemResult[] = [];
  for (const item of items) {
    const clientId = typeof item?.clientId === "string" ? item.clientId : "";
    try {
      // Solo se aceptan los campos de una inspección de línea: el resto lo deduce el servidor.
      await recordInspection(deps, actor, {
        clientId,
        batchId: item.batchId,
        source: "LINE",
        modelVersion: item.modelVersion,
        predictedVerdict: item.predictedVerdict,
        confidence: item.confidence,
        thresholdApplied: item.thresholdApplied,
        imageKey: item.imageKey,
        pieceNumber: item.pieceNumber,
        inferenceMs: item.inferenceMs,
        backend: item.backend,
        warnings: item.warnings,
        capturedAt: item.capturedAt,
      });
      results.push({ clientId, ok: true });
    } catch (error) {
      if (!(error instanceof InspectionError)) throw error;
      results.push({ clientId, ok: false, code: error.code, message: error.message });
    }
  }
  await deps.db.station.update({ where: { id: actor.stationId }, data: { lastSeenAt: deps.now?.() ?? new Date() } });
  return results;
}

// ─── Administración (HU44-T04) ────────────────────────────────────────────────

const PERMISSION = "estaciones:gestionar" as const;

async function companyOf(actor: AuthzUser, action: string): Promise<string> {
  await authorize(actor, PERMISSION, { empresaId: actor.empresaId, path: action });
  if (!actor.empresaId) throw new StationError("NOT_FOUND", "Tu cuenta no pertenece a ninguna empresa");
  return actor.empresaId;
}

function fieldsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new StationError("INVALID", "Revisa los campos marcados", fieldsOf(result.error));
  return result.data;
}

const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const stationSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre de la estación").max(60, "Máximo 60 caracteres"),
  line: z.string().trim().min(1, "Escribe la línea").max(60, "Máximo 60 caracteres"),
});

export const newStationSchema = (limits: { min: number; max: number }) =>
  stationSchema.extend({
    email: z.email("Correo no válido").trim().toLowerCase().max(200),
    password: z
      .string()
      .min(limits.min, `La contraseña debe tener al menos ${limits.min} caracteres`)
      .max(limits.max, `La contraseña no puede tener más de ${limits.max} caracteres`),
  });

export async function listStations(db: PrismaClient, actor: AuthzUser) {
  const companyId = await companyOf(actor, "listStations");
  const [stations, batches] = await Promise.all([
    db.station.findMany({
      where: { companyId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        line: true,
        active: true,
        config: true,
        lastSeenAt: true,
        currentBatch: { select: { id: true, code: true, status: true } },
        user: { select: { email: true, active: true } },
        _count: { select: { inspections: true } },
      },
    }),
    db.batch.findMany({
      where: { companyId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      take: 100,
      select: { id: true, code: true, mold: { select: { code: true, part: { select: { code: true } } } } },
    }),
  ]);
  return {
    stations: stations.map(({ config, _count, ...station }) => ({
      ...station,
      config: parseStationConfig(config),
      inspections: _count.inspections,
    })),
    openBatches: batches,
  };
}

export type StationList = Awaited<ReturnType<typeof listStations>>;

/** Crea la estación y su cuenta técnica (rol STATION) en una transacción. */
export async function createStation(
  db: PrismaClient,
  actor: AuthzUser,
  input: unknown,
  limits: { min: number; max: number },
) {
  const companyId = await companyOf(actor, "createStation");
  const data = parse(newStationSchema(limits), input);
  if (await db.user.findUnique({ where: { email: data.email }, select: { id: true } })) {
    throw new StationError("EMAIL_IN_USE", "Ya existe una cuenta con ese correo", { email: "Ya existe una cuenta con ese correo" });
  }
  try {
    return await db.$transaction(async (tx) => {
      const user = await createCredentialUser(
        { email: data.email, name: `Estación ${data.name}`, password: data.password, role: "STATION", companyId },
        tx,
      );
      return tx.station.create({
        data: { companyId, name: data.name, line: data.line, userId: user.id },
        select: { id: true },
      });
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new StationError("DUPLICATE", "Ya hay una estación con ese nombre", { name: "Ya hay una estación con ese nombre" });
    }
    throw error;
  }
}

async function stationOf(db: PrismaClient, companyId: string, id: string) {
  const station = await db.station.findFirst({ where: { id, companyId }, select: { id: true, userId: true } });
  if (!station) throw new StationError("NOT_FOUND", "La estación no existe en tu planta");
  return station;
}

export async function updateStation(db: PrismaClient, actor: AuthzUser, id: string, input: unknown) {
  const companyId = await companyOf(actor, "updateStation");
  const data = parse(stationSchema, input);
  await stationOf(db, companyId, id);
  try {
    await db.station.update({ where: { id }, data });
  } catch (error) {
    if (isUnique(error)) {
      throw new StationError("DUPLICATE", "Ya hay una estación con ese nombre", { name: "Ya hay una estación con ese nombre" });
    }
    throw error;
  }
}

/** Asigna el lote que inspecciona la estación (o ninguno). Solo lotes abiertos de la empresa. */
export async function assignBatch(db: PrismaClient, actor: AuthzUser, id: string, batchId: string | null) {
  const companyId = await companyOf(actor, "assignStationBatch");
  await stationOf(db, companyId, id);
  if (batchId) {
    const batch = await db.batch.findFirst({ where: { id: batchId, companyId }, select: { status: true } });
    if (!batch) throw new StationError("NOT_FOUND", "El lote no existe en tu planta", { batchId: "Elige un lote de la lista" });
    if (batch.status !== "OPEN") throw new StationError("BATCH_CLOSED", "El lote está cerrado", { batchId: "El lote está cerrado" });
  }
  await db.station.update({ where: { id }, data: { currentBatchId: batchId } });
}

/** Guarda la calibración y los parámetros de la estación. */
export async function saveStationConfig(db: PrismaClient, actor: AuthzUser, id: string, input: unknown) {
  const companyId = await companyOf(actor, "saveStationConfig");
  const config = parse(stationConfigSchema, input);
  await stationOf(db, companyId, id);
  await db.station.update({ where: { id }, data: { config } });
  return config;
}

/** Activa o desactiva la estación. Al desactivarla se cierran las sesiones de su cuenta técnica. */
export async function setStationActive(db: PrismaClient, actor: AuthzUser, id: string, active: boolean) {
  const companyId = await companyOf(actor, "setStationActive");
  const station = await stationOf(db, companyId, id);
  await db.$transaction([
    db.station.update({ where: { id }, data: { active } }),
    ...(station.userId
      ? [
          db.user.update({ where: { id: station.userId }, data: { active } }),
          ...(active ? [] : [db.session.deleteMany({ where: { userId: station.userId } })]),
        ]
      : []),
  ]);
}

/**
 * Calibración desde la propia estación (HU44-T04): la cuenta técnica guarda
 * los umbrales medidos con la cinta vacía. No toca el resto de parámetros.
 */
export async function saveCalibration(
  db: PrismaClient,
  actor: Actor,
  input: { presenceThreshold: number; motionThreshold: number },
) {
  if (actor.role !== "STATION" || !actor.stationId || !actor.companyId) {
    throw new InspectionError("FORBIDDEN", "Solo la cuenta técnica de una estación activa calibra la estación");
  }
  const thresholds = parse(stationConfigSchema.pick({ presenceThreshold: true, motionThreshold: true }), input);
  const station = await db.station.findFirstOrThrow({
    where: { id: actor.stationId, companyId: actor.companyId },
    select: { config: true },
  });
  const config = { ...parseStationConfig(station.config), ...thresholds };
  await db.station.update({ where: { id: actor.stationId }, data: { config } });
  return config;
}
