import { shouldKeepOkPhoto } from "@/lib/inspections/rules";
import type { StationConfig } from "./config";
import { createDetector, frameDifference, type Detector, type Phase } from "./detector";
import type { InspectionQueue, PendingInspection } from "./queue";

/**
 * Ciclo de la estación (HU44-T01 y T03, RIKDP-226 y RIKDP-228), sin React ni
 * cámara para poder probarlo: la página le pasa cada fotograma reducido y le
 * da una función que ejecuta el modelo sobre el fotograma actual.
 *
 * Por cada pieza: una inferencia, un registro en la cola local y, si es
 * defectuosa o es la OK número N, su foto.
 */

export type ModelResult = {
  verdict: "OK" | "DEFECTIVE";
  confidence: number;
  inferenceMs: number;
  /** Foto JPEG de lo que vio el modelo. Solo se pide si se conserva. */
  photo(): Promise<Blob>;
};

export type StationContext = {
  batchId: string;
  modelVersion: string;
  threshold: number;
  backend?: "WEBGL" | "WASM";
};

export type InspectedPiece = {
  clientId: string;
  pieceNumber: number;
  verdict: "OK" | "DEFECTIVE";
  confidence: number;
  inferenceMs: number;
  warnings: string[];
  photoKept: boolean;
  at: number;
};

export type Counters = { total: number; ok: number; defective: number };

export type EngineDeps = {
  config: StationConfig;
  context: StationContext;
  /** Fondo de la cinta vacía tomado al calibrar (64×64 en gris). */
  background: Uint8Array;
  queue: InspectionQueue;
  classify(): Promise<ModelResult>;
  newId(): string;
  now(): Date;
  /** Último número de pieza registrado en el lote. */
  lastPieceNumber: number;
};

export class StationEngine {
  private readonly detector: Detector;
  private previous: Uint8Array | null = null;
  private inspectedFrame: Uint8Array | null = null;
  private okSinceLastPhoto = 0;
  private busy = false;
  private pieceNumber: number;
  readonly counters: Counters = { total: 0, ok: 0, defective: 0 };
  /** Instantes de las últimas inspecciones, para el ritmo de la línea. */
  readonly recent: number[] = [];

  constructor(private readonly deps: EngineDeps) {
    this.detector = createDetector(deps.config);
    this.pieceNumber = deps.lastPieceNumber;
  }

  get phase(): Phase {
    return this.detector.phase;
  }

  get inferring(): boolean {
    return this.busy;
  }

  /**
   * Procesa un fotograma. Si corresponde inspeccionar, ejecuta el modelo una
   * vez y devuelve la pieza registrada. Mientras una inferencia está en curso,
   * los fotogramas solo actualizan la detección.
   */
  async processFrame(gray: Uint8Array, at: number): Promise<InspectedPiece | null> {
    const presence = frameDifference(gray, this.deps.background);
    const motion = this.previous ? frameDifference(gray, this.previous) : 1;
    const change = this.inspectedFrame ? frameDifference(gray, this.inspectedFrame) : undefined;
    this.previous = gray;

    const event = this.detector.step({ presence, motion, change, at });
    if (!event || this.busy) return null;

    this.busy = true;
    this.inspectedFrame = gray;
    try {
      return await this.inspect(event.warnings, at);
    } finally {
      this.busy = false;
    }
  }

  private async inspect(warnings: string[], at: number): Promise<InspectedPiece> {
    const result = await this.deps.classify();
    const defective = result.verdict === "DEFECTIVE";

    let photoKept = defective;
    if (!defective) {
      this.okSinceLastPhoto += 1;
      if (shouldKeepOkPhoto(this.okSinceLastPhoto, this.deps.config.okPhotoEvery)) {
        photoKept = true;
        this.okSinceLastPhoto = 0;
      }
    }

    this.pieceNumber += 1;
    const item: PendingInspection = {
      clientId: this.deps.newId(),
      batchId: this.deps.context.batchId,
      pieceNumber: this.pieceNumber,
      modelVersion: this.deps.context.modelVersion,
      predictedVerdict: result.verdict,
      confidence: result.confidence,
      thresholdApplied: this.deps.context.threshold,
      inferenceMs: Math.round(result.inferenceMs),
      ...(this.deps.context.backend ? { backend: this.deps.context.backend } : {}),
      warnings,
      capturedAt: this.deps.now().toISOString(),
      ...(photoKept ? { photo: await result.photo() } : {}),
      attempts: 0,
      queuedAt: Date.now(),
    };
    await this.deps.queue.add(item);

    this.counters.total += 1;
    if (defective) this.counters.defective += 1;
    else this.counters.ok += 1;
    this.recent.push(at);
    while (this.recent.length > 0 && at - this.recent[0] > 60_000) this.recent.shift();

    return {
      clientId: item.clientId,
      pieceNumber: item.pieceNumber,
      verdict: result.verdict,
      confidence: result.confidence,
      inferenceMs: result.inferenceMs,
      warnings,
      photoKept,
      at,
    };
  }
}

/** Fondo y ruido de la cinta vacía a partir de los fotogramas de calibración. */
export function measureNoise(frames: readonly Uint8Array[], background: Uint8Array): { presence: number; motion: number } {
  if (frames.length < 2) throw new RangeError("Se necesitan al menos 2 fotogramas");
  let presence = 0;
  let motion = 0;
  for (let i = 0; i < frames.length; i += 1) {
    presence = Math.max(presence, frameDifference(frames[i], background));
    if (i > 0) motion = Math.max(motion, frameDifference(frames[i], frames[i - 1]));
  }
  return { presence, motion };
}
