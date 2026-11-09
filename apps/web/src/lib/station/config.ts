import { z } from "zod";
import { DEFAULT_OK_PHOTO_EVERY } from "@/lib/inspections/rules";

/**
 * Parámetros de una estación automática (HU44-T04, RIKDP-271). Se guardan en
 * `station.config` y los ajusta el admin de planta al calibrar. Valores por
 * defecto: docs/arquitectura/inferencia-navegador.md, «Parámetros por estación».
 */

export const DEFAULT_STATION_CONFIG = {
  presenceThreshold: 0.12,
  motionThreshold: 0.02,
  stableFrames: 3,
  maxWaitMs: 2000,
  okPhotoEvery: DEFAULT_OK_PHOTO_EVERY,
  targetPiecesPerSecond: 1,
} as const;

export const stationConfigSchema = z.object({
  presenceThreshold: z.number("Escribe un número").gt(0, "Mayor que 0").lt(1, "Menor que 1"),
  motionThreshold: z.number("Escribe un número").gt(0, "Mayor que 0").lt(1, "Menor que 1"),
  stableFrames: z.number("Escribe un número").int("Número entero").min(1, "Al menos 1").max(30, "Máximo 30"),
  maxWaitMs: z.number("Escribe un número").int("Número entero").min(300, "Al menos 300 ms").max(10_000, "Máximo 10 000 ms"),
  okPhotoEvery: z.number("Escribe un número").int("Número entero").min(1, "Al menos 1").max(1000, "Máximo 1000"),
  targetPiecesPerSecond: z.number("Escribe un número").gt(0, "Mayor que 0").max(5, "Máximo 5"),
});

export type StationConfig = z.infer<typeof stationConfigSchema>;
export type StationConfigField = keyof StationConfig;

/**
 * Lee `station.config` campo por campo: un valor que falta o no es válido se
 * reemplaza por el de defecto, así una configuración a medias no detiene la línea.
 */
export function parseStationConfig(raw: unknown): StationConfig {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config: Record<string, number> = { ...DEFAULT_STATION_CONFIG };
  for (const key of Object.keys(stationConfigSchema.shape) as StationConfigField[]) {
    const field = stationConfigSchema.shape[key].safeParse(source[key]);
    if (field.success) config[key] = field.data;
  }
  return config as StationConfig;
}
