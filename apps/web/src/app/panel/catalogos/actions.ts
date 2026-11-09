"use server";

import { revalidatePath } from "next/cache";
import { getActionUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/authz";
import {
  CatalogError,
  createBatch,
  createMold,
  createPart,
  createShift,
  deleteBatch,
  setBatchStatus,
  setMoldActive,
  setPartActive,
  setShiftActive,
  updatePart,
  updateShift,
} from "@/lib/catalogs/service";
import { getDb, isDatabaseConfigured } from "@/lib/db";

/**
 * Server Action única de los catálogos (HU31/HU33). El campo `intent` del
 * formulario dice qué hacer; cada operación vuelve a comprobar sesión, permiso
 * y empresa en src/lib/catalogs/service.ts.
 */

export type CatalogFormState =
  | { status: "idle" }
  | { status: "saved"; message: string; at: number }
  | { status: "error"; message: string; fields: Record<string, string>; values: Record<string, string> };

const str = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.slice(0, 500) : "";
};

type Handler = (form: FormData) => Promise<string>;

export async function catalogAction(_previous: CatalogFormState, form: FormData): Promise<CatalogFormState> {
  const values = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 500)]));
  try {
    if (!isDatabaseConfigured()) throw new CatalogError("NOT_FOUND", "La base de datos no está configurada");
    const user = await getActionUser();
    if (!user) throw new ForbiddenError("catalogos:gestionar", "NO_AUTENTICADO");
    const db = getDb();
    const id = str(form, "id");

    const handlers: Record<string, Handler> = {
      "part:create": async () => {
        await createPart(db, user, { code: str(form, "code"), name: str(form, "name"), description: str(form, "description") });
        return "Pieza registrada.";
      },
      "part:update": async () => {
        await updatePart(db, user, id, { code: str(form, "code"), name: str(form, "name"), description: str(form, "description") });
        return "Pieza actualizada.";
      },
      "part:toggle": async () => {
        const active = str(form, "active") === "true";
        await setPartActive(db, user, id, active);
        return active ? "Pieza activada." : "Pieza desactivada.";
      },
      "mold:create": async () => {
        await createMold(db, user, { partId: str(form, "partId"), code: str(form, "code"), cavities: str(form, "cavities") || "1" });
        return "Molde registrado.";
      },
      "mold:toggle": async () => {
        const active = str(form, "active") === "true";
        await setMoldActive(db, user, id, active);
        return active ? "Molde activado." : "Molde desactivado.";
      },
      "batch:create": async () => {
        await createBatch(db, user, { moldId: str(form, "moldId"), code: str(form, "code") });
        return "Lote abierto.";
      },
      "batch:close": async () => {
        await setBatchStatus(db, user, id, "CLOSED");
        return "Lote cerrado.";
      },
      "batch:reopen": async () => {
        await setBatchStatus(db, user, id, "OPEN");
        return "Lote reabierto.";
      },
      "batch:delete": async () => {
        await deleteBatch(db, user, id);
        return "Lote eliminado.";
      },
      "shift:create": async () => {
        await createShift(db, user, { name: str(form, "name"), startTime: str(form, "startTime"), endTime: str(form, "endTime") });
        return "Turno registrado.";
      },
      "shift:update": async () => {
        await updateShift(db, user, id, { name: str(form, "name"), startTime: str(form, "startTime"), endTime: str(form, "endTime") });
        return "Turno actualizado.";
      },
      "shift:toggle": async () => {
        const active = str(form, "active") === "true";
        await setShiftActive(db, user, id, active);
        return active ? "Turno activado." : "Turno desactivado.";
      },
    };

    const handler = handlers[str(form, "intent")];
    if (!handler) throw new CatalogError("INVALID", "Acción desconocida");
    const message = await handler(form);
    revalidatePath("/panel/catalogos");
    return { status: "saved", message, at: Date.now() };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { status: "error", message: "Tu rol no puede modificar los catálogos.", fields: {}, values };
    }
    if (error instanceof CatalogError) return { status: "error", message: error.message, fields: error.fields, values };
    console.error("[catalogos] error inesperado", error);
    return { status: "error", message: "No se pudo guardar. Inténtalo de nuevo.", fields: {}, values };
  }
}
