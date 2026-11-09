"use server";

import { revalidatePath } from "next/cache";
import type { CatalogFormState } from "@/app/panel/catalogos/actions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/config";
import { getActionUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/authz";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { assignBatch, createStation, saveStationConfig, setStationActive, StationError, updateStation } from "@/lib/station/service";

/**
 * Server Action de HU44-T04 · Estaciones automáticas (RIKDP-271). El campo
 * `intent` dice qué hacer; cada operación vuelve a comprobar sesión, permiso
 * `estaciones:gestionar` y empresa en src/lib/station/service.ts.
 */

const PATH = "/panel/admin/estaciones";

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.slice(0, 300) : "";
};

const num = (form: FormData, key: string) => {
  const value = str(form, key).replace(",", ".").trim();
  return value === "" ? Number.NaN : Number(value);
};

export async function stationAction(_previous: CatalogFormState, form: FormData): Promise<CatalogFormState> {
  // La contraseña nunca vuelve al navegador.
  const values = Object.fromEntries(
    [...form.entries()].filter(([k, v]) => typeof v === "string" && k !== "password").map(([k, v]) => [k, String(v).slice(0, 300)]),
  );
  try {
    if (!isDatabaseConfigured()) throw new StationError("NOT_FOUND", "La base de datos no está configurada");
    const user = await getActionUser();
    if (!user) throw new ForbiddenError("estaciones:gestionar", "NO_AUTENTICADO");
    const db = getDb();
    const id = str(form, "id");

    const handlers: Record<string, () => Promise<string>> = {
      "station:create": async () => {
        await createStation(
          db,
          user,
          { name: str(form, "name"), line: str(form, "line"), email: str(form, "email"), password: str(form, "password") },
          { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH },
        );
        return "Estación creada. Ingresa con su cuenta técnica en el equipo de la línea y abre «Estación».";
      },
      "station:update": async () => {
        await updateStation(db, user, id, { name: str(form, "name"), line: str(form, "line") });
        return "Estación actualizada.";
      },
      "station:batch": async () => {
        await assignBatch(db, user, id, str(form, "batchId") || null);
        return str(form, "batchId") ? "Lote asignado. La estación lo tomará en menos de un minuto." : "La estación quedó sin lote.";
      },
      "station:config": async () => {
        await saveStationConfig(db, user, id, {
          presenceThreshold: num(form, "presenceThreshold"),
          motionThreshold: num(form, "motionThreshold"),
          stableFrames: num(form, "stableFrames"),
          maxWaitMs: num(form, "maxWaitMs"),
          okPhotoEvery: num(form, "okPhotoEvery"),
          targetPiecesPerSecond: num(form, "targetPiecesPerSecond"),
        });
        return "Configuración guardada. La estación la aplicará en menos de un minuto.";
      },
      "station:toggle": async () => {
        const active = str(form, "active") === "true";
        await setStationActive(db, user, id, active);
        return active ? "Estación activada." : "Estación desactivada y su sesión cerrada.";
      },
    };

    const handler = handlers[str(form, "intent")];
    if (!handler) throw new StationError("INVALID", "Operación no reconocida");
    const message = await handler();
    revalidatePath(PATH);
    return { status: "saved", message, at: Date.now() };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { status: "error", message: "Tu rol no puede gestionar estaciones.", fields: {}, values };
    }
    if (error instanceof StationError) return { status: "error", message: error.message, fields: error.fields, values };
    console.error("[estaciones] error inesperado", error);
    return { status: "error", message: "No se pudo guardar. Inténtalo de nuevo.", fields: {}, values };
  }
}
