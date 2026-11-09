"use server";

import { getSession } from "@/lib/auth/server";
import { authorize, ForbiddenError, type Permission } from "@/lib/authz";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import {
  correctVerdict,
  InspectionError,
  loadActor,
  recordInspection,
  type Actor,
  type InspectionErrorCode,
} from "@/lib/inspections/service";
import type { CorrectVerdictInput, RecordInspectionInput } from "@/lib/inspections/schema";
import { canRecord } from "@/lib/inspections/rules";
import { createImageUpload, isStorageConfigured, type ImageUpload } from "@/lib/storage/r2";

/**
 * Server Actions de la trazabilidad (HU24). Siguen la secuencia de
 * docs/arquitectura/README.md: pedir URL de subida → subir a R2 → registrar.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: InspectionErrorCode | "UNAUTHENTICATED" | "UNAVAILABLE"; message: string };

const fail = <T>(code: Exclude<ActionResult<T>, { ok: true }>["code"], message: string): ActionResult<T> => ({
  ok: false,
  code,
  message,
});

async function currentActor(): Promise<Actor | ActionResult<never>> {
  if (!isDatabaseConfigured()) return fail("UNAVAILABLE", "La base de datos no está configurada");
  const session = await getSession();
  if (!session) return fail("UNAUTHENTICATED", "Inicia sesión para continuar");
  const actor = await loadActor(getDb(), session.user.id);
  if (!actor) return fail("UNAUTHENTICATED", "Tu cuenta no está activa");
  return actor;
}

const isFailure = (value: Actor | ActionResult<never>): value is ActionResult<never> => "ok" in value;

const FORBIDDEN_MESSAGES: Partial<Record<Permission, string>> = {
  "inspecciones:crear": "Tu rol no puede registrar inspecciones",
  "veredictos:corregir": "Tu rol no puede corregir veredictos",
};

/**
 * Ejecuta la acción si el rol tiene el permiso de la matriz (HU32-T02). Un
 * intento denegado queda en el registro de accesos (HU32-T03); las reglas de
 * negocio de HU24 se siguen comprobando dentro del servicio.
 */
async function run<T>(
  permission: Permission,
  action: string,
  work: (actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  const actor = await currentActor();
  if (isFailure(actor)) return actor;
  try {
    await authorize({ id: actor.userId, role: actor.role, empresaId: actor.companyId }, permission, { path: action });
    return { ok: true, data: await work(actor) };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fail("FORBIDDEN", FORBIDDEN_MESSAGES[permission] ?? "Tu rol no puede realizar esta acción");
    }
    if (error instanceof InspectionError) return fail(error.code, error.message);
    console.error("[inspecciones] error inesperado", error);
    return fail("UNAVAILABLE", "No se pudo completar la operación. Inténtalo de nuevo.");
  }
}

/** Paso 1: URL prefirmada para subir la foto directamente a R2 (ADR 0005). */
export async function requestImageUpload(): Promise<ActionResult<ImageUpload>> {
  return run("inspecciones:crear", "requestImageUpload", async (actor) => {
    if (!actor.companyId) throw new InspectionError("FORBIDDEN", "Tu cuenta no pertenece a ninguna empresa");
    const source = actor.role === "STATION" ? "LINE" : "UPLOAD";
    if (!canRecord(actor.role, source)) throw new InspectionError("FORBIDDEN", "Tu rol no puede registrar inspecciones");
    if (!isStorageConfigured()) {
      throw new InspectionError("STORAGE_NOT_CONFIGURED", "El almacenamiento de imágenes no está configurado");
    }
    return createImageUpload(actor.companyId);
  });
}

/** Paso 3: registra la inspección con la clave de la foto ya subida. */
export async function saveInspection(input: RecordInspectionInput): Promise<ActionResult<{ id: string; duplicate: boolean }>> {
  return run("inspecciones:crear", "saveInspection", (actor) => recordInspection({ db: getDb() }, actor, input));
}

/** Corrige el veredicto de una inspección como evento nuevo (HU40). */
export async function correctInspection(input: CorrectVerdictInput) {
  return run("veredictos:corregir", "correctInspection", (actor) => correctVerdict({ db: getDb() }, actor, input));
}
