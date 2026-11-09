import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATION_CONFIG } from "./config";
import { WARNING_MOTION } from "./detector";
import { measureNoise, StationEngine, type ModelResult } from "./engine";
import { createMemoryQueue } from "./queue";

const SIZE = 64 * 64;
const empty = () => new Uint8Array(SIZE).fill(40);
/** Pieza clara en el centro; `shift` la desplaza para simular movimiento. */
function piece(shift = 0, tone = 220): Uint8Array {
  const frame = empty();
  for (let y = 16; y < 48; y += 1) for (let x = 16 + shift; x < 48 + shift; x += 1) frame[y * 64 + x] = tone;
  return frame;
}

function setup(verdicts: ("OK" | "DEFECTIVE")[], okPhotoEvery = 3) {
  const queue = createMemoryQueue();
  let n = 0;
  const classify = vi.fn(async (): Promise<ModelResult> => {
    const verdict = verdicts[n++ % verdicts.length];
    return { verdict, confidence: 0.91, inferenceMs: 210.4, photo: async () => new Blob([new Uint8Array([1])]) };
  });
  const engine = new StationEngine({
    config: { ...DEFAULT_STATION_CONFIG, okPhotoEvery },
    context: { batchId: "lote-1", modelVersion: "1.0.0", threshold: 0.24, backend: "WEBGL" },
    background: empty(),
    queue,
    classify,
    newId: () => crypto.randomUUID(),
    now: () => new Date("2026-11-09T15:00:00Z"),
    lastPieceNumber: 41,
  });
  let t = 0;
  async function feed(...frames: Uint8Array[]) {
    const pieces = [];
    for (const frame of frames) {
      const result = await engine.processFrame(frame, (t += 100));
      if (result) pieces.push(result);
    }
    return pieces;
  }
  /** Una pieza completa: entra moviéndose, se detiene y sale. */
  const pass = () => feed(piece(-8), piece(-4), piece(), piece(), piece(), piece(), piece(4), empty(), empty(), empty());
  return { engine, queue, classify, feed, pass };
}

describe("ciclo de la estación (HU44-T01, T03)", () => {
  it("registra cada pieza una vez, con su número y sin foto si es OK", async () => {
    const { engine, queue, classify, pass } = setup(["OK"]);
    const [first] = await pass();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ pieceNumber: 42, verdict: "OK", photoKept: false, warnings: [] });
    const [stored] = await queue.peek(1);
    expect(stored).toMatchObject({
      batchId: "lote-1",
      pieceNumber: 42,
      predictedVerdict: "OK",
      thresholdApplied: 0.24,
      inferenceMs: 210,
      backend: "WEBGL",
      capturedAt: "2026-11-09T15:00:00.000Z",
    });
    expect(stored.photo).toBeUndefined();
    expect(engine.phase).toBe("EMPTY");
  });

  it("guarda la foto de todas las defectuosas y de 1 de cada N OK", async () => {
    const { engine, queue, pass } = setup(["OK", "DEFECTIVE", "OK", "OK", "OK", "OK", "OK"], 3);
    const kept: boolean[] = [];
    for (let i = 0; i < 7; i += 1) kept.push(...(await pass()).map((p) => p.photoKept));
    // OK1 no, DEF sí, OK2 no, OK3 sí (3.ª OK), OK4 no, OK5 no, OK6 sí.
    expect(kept).toEqual([false, true, false, true, false, false, true]);
    expect(engine.counters).toEqual({ total: 7, ok: 6, defective: 1 });
    expect(await queue.size()).toBe(7);
  });

  it("una pieza que no se detiene se inspecciona con aviso", async () => {
    const { feed } = setup(["OK"]);
    const moving = Array.from({ length: 25 }, (_, i) => piece(i % 2 === 0 ? 4 : -4));
    const pieces = await feed(...moving);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].warnings).toEqual([WARNING_MOTION]);
  });

  it("no apila inferencias: la siguiente pieza espera a que la escena se vacíe", async () => {
    const { classify, feed } = setup(["OK"]);
    await feed(piece(-4), piece(), piece(), piece(), ...Array.from({ length: 50 }, () => piece()));
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("measureNoise mide el ruido máximo de la cinta vacía", () => {
    const frames = [empty(), empty(), empty()];
    frames[1][0] = 40 + 255 * 0.5;
    const noise = measureNoise(frames, empty());
    expect(noise.presence).toBeGreaterThan(0);
    expect(noise.motion).toBeGreaterThan(0);
  });
});
