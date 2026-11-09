"use server";

import { getSession } from "@/lib/auth/server";
import { authorize, ForbiddenError } from "@/lib/authz";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { InspectionError, loadActor, type Actor } from "@/lib/inspections/service";
import type { StationConfig } from "@/lib/station/config";
import type { SyncItemResult, SyncPayload, UploadTarget } from "@/lib/station/queue";
import {
  loadStationContext,
  saveCalibration,
  StationError,
  SYNC_MAX_ITEMS,
  syncStationInspections,
  type StationContextData,
} from "@/lib/station/service";
import { createImageUpload, isStorageConfigured } from "@/lib/storage/r2";

/**
 * Server Actions de la estación automática (HU44). Solo las usa la cuenta
 * técnica: cada una vuelve a comprobar la sesión, el permiso `estacion:operar`
 * y que la estación siga activa.
 */

export type StationResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function run<T>(action: string, work: (actor: Actor) => Promise<T>): Promise<StationResult<T>> {
  if (!isDatabaseConfigured()) return { ok: false, code: "UNAVAILABLE", message: "La base de datos no está configurada" };
  const session = await getSession();
  if (!session) return { ok: false, code: "UNAUTHENTICATED", message: "La sesión de la estación terminó" };
  const actor = await loadActor(getDb(), session.user.id);
  if (!actor) return { ok: false, code: "UNAUTHENTICATED", message: "La cuenta de la estación no está activa" };
  try {
    await authorize({ id: actor.userId, role: actor.role, empresaId: actor.companyId }, "estacion:operar", { path: action });
    return { ok: true, data: await work(actor) };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: "FORBIDDEN", message: "Solo una estación puede usar esta pantalla" };
    if (error instanceof InspectionError || error instanceof StationError) {
      return { ok: false, code: error.code, message: error.message };
    }
    console.error("[estacion] error inesperado", error);
    return { ok: false, code: "UNAVAILABLE", message: "No se pudo completar la operación. Se reintentará." };
  }
}

/** Lote, turno, configuración y contadores actuales de la estación. */
export async function refreshStationContext(): Promise<StationResult<StationContextData>> {
  return run("refreshStationContext", (actor) => loadStationContext(getDb(), actor));
}

/** URLs prefirmadas para subir las fotos del lote a R2 (ADR 0005). */
export async function requestStationUploads(count: number): Promise<StationResult<UploadTarget[]>> {
  return run("requestStationUploads", async (actor) => {
    if (!Number.isInteger(count) || count < 1 || count > SYNC_MAX_ITEMS) {
      throw new InspectionError("INVALID", `Pide entre 1 y ${SYNC_MAX_ITEMS} URLs`);
    }
    if (!actor.companyId) throw new InspectionError("FORBIDDEN", "La estación no pertenece a ninguna empresa");
    if (!isStorageConfigured()) {
      throw new InspectionError("STORAGE_NOT_CONFIGURED", "El almacenamiento de imágenes no está configurado");
    }
    return Array.from({ length: count }, () => {
      const upload = createImageUpload(actor.companyId!);
      return { key: upload.key, uploadUrl: upload.uploadUrl, headers: upload.headers };
    });
  });
}

/** Registra un lote de inspecciones de la cola local. */
export async function syncStationBatch(items: SyncPayload[]): Promise<StationResult<SyncItemResult[]>> {
  return run("syncStationBatch", (actor) => syncStationInspections({ db: getDb() }, actor, items));
}

/** Guarda los umbrales medidos al calibrar con la cinta vacía. */
export async function saveStationCalibration(input: {
  presenceThreshold: number;
  motionThreshold: number;
}): Promise<StationResult<StationConfig>> {
  return run("saveStationCalibration", (actor) => saveCalibration(getDb(), actor, input));
}
