import "server-only";
import { randomUUID } from "node:crypto";
import { presignUrl } from "./sigv4";

/**
 * Imágenes de inspección en Cloudflare R2 (HU24-T02, RIKDP-150; ADR 0005).
 *
 * El bucket de imágenes es privado: el navegador sube y lee solo con URLs
 * prefirmadas de corta duración, y la clave del objeto la decide el servidor.
 */

/** Validez de la URL de subida: suficiente para una foto de hasta 5 MB en una red de planta. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
/** Validez de la URL de lectura para ver la foto en el detalle de la inspección. */
export const READ_URL_TTL_SECONDS = 5 * 60;

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class StorageNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Falta configurar R2 para imágenes: ${missing.join(", ")}`);
    this.name = "StorageNotConfiguredError";
  }
}

const ENV_VARS = {
  endpoint: "R2_ENDPOINT_URL",
  bucket: "R2_IMAGES_BUCKET",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
} as const;

/** Lee la configuración del entorno. Lanza StorageNotConfiguredError si falta algo. */
export function getR2Config(env: Record<string, string | undefined> = process.env): R2Config {
  const missing = Object.values(ENV_VARS).filter((name) => !env[name]);
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);
  return {
    endpoint: env[ENV_VARS.endpoint]!.replace(/\/+$/, ""),
    bucket: env[ENV_VARS.bucket]!,
    accessKeyId: env[ENV_VARS.accessKeyId]!,
    secretAccessKey: env[ENV_VARS.secretAccessKey]!,
  };
}

export function isStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Object.values(ENV_VARS).every((name) => Boolean(env[name]));
}

// ─── Claves de objeto ──────────────────────────────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(`^companies/(${UUID})/inspections/(\\d{4})/(0[1-9]|1[0-2])/(${UUID})\\.jpg$`);

/** Clave del objeto: companies/{company_id}/inspections/{yyyy}/{mm}/{uuid}.jpg (ADR 0005). */
export function buildImageKey(companyId: string, now: Date = new Date(), id: string = randomUUID()): string {
  if (!new RegExp(`^${UUID}$`).test(companyId)) throw new Error("companyId inválido");
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `companies/${companyId}/inspections/${yyyy}/${mm}/${id}.jpg`;
}

/** Indica si `key` es una clave de imagen bien formada que pertenece a la empresa. */
export function isImageKeyOfCompany(key: string, companyId: string): boolean {
  const match = KEY_PATTERN.exec(key);
  return match !== null && match[1] === companyId;
}

// ─── URLs prefirmadas ──────────────────────────────────────────────────────

function objectUrl(config: R2Config, key: string): string {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${key}`;
}

function sign(config: R2Config, method: "GET" | "PUT" | "HEAD", key: string, expiresIn: number, now?: Date) {
  return presignUrl({
    method,
    url: objectUrl(config, key),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    region: "auto",
    expiresIn,
    now,
  });
}

export type ImageUpload = {
  key: string;
  uploadUrl: string;
  method: "PUT";
  headers: { "content-type": "image/jpeg" };
  expiresAt: Date;
};

/** Genera la clave y la URL prefirmada para que el navegador suba la foto directamente a R2. */
export function createImageUpload(companyId: string, config: R2Config = getR2Config(), now: Date = new Date()): ImageUpload {
  const key = buildImageKey(companyId, now);
  return {
    key,
    uploadUrl: sign(config, "PUT", key, UPLOAD_URL_TTL_SECONDS, now),
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
  };
}

/** URL de lectura de corta duración para mostrar la foto de una inspección. */
export function createImageReadUrl(key: string, config: R2Config = getR2Config(), now: Date = new Date()): string {
  return sign(config, "GET", key, READ_URL_TTL_SECONDS, now);
}

/**
 * Comprueba que el objeto existe en R2 antes de registrar la inspección (ADR 0005,
 * paso 4). Responde false si no existe; lanza si R2 no responde como se espera.
 */
export async function imageExists(
  key: string,
  config: R2Config = getR2Config(),
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl(sign(config, "HEAD", key, 60), { method: "HEAD", cache: "no-store" });
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(`R2 respondió ${response.status} al comprobar la imagen`);
}
