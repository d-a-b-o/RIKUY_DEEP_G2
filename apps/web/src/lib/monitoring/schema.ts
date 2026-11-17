import { z } from "zod";

export const LOAD_STAGES = ["manifest", "cache", "download", "backend", "warmup"] as const;
const version = z.string().regex(/^\d+\.\d+\.\d+$/).max(64);
export const telemetryEventSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.uuid(), type: z.literal("INFERENCE"), version,
    durationMs: z.number().int().min(0).max(600_000),
    backend: z.enum(["WEBGL", "WASM", "CPU"]),
  }).strict(),
  z.object({
    id: z.uuid(), type: z.literal("LOAD_ERROR"), stage: z.enum(LOAD_STAGES),
  }).strict(),
]);
export const telemetryBatchSchema = z.object({ events: z.array(telemetryEventSchema).min(1).max(50) }).strict();
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
