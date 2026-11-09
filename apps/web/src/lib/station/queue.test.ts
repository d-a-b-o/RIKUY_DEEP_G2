import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  createIndexedDbQueue,
  createMemoryQueue,
  flushQueue,
  shouldFlush,
  type InspectionQueue,
  type PendingInspection,
  type SyncDeps,
  type SyncPayload,
} from "./queue";

let seq = 0;
function pending(overrides: Partial<PendingInspection> = {}): PendingInspection {
  seq += 1;
  return {
    clientId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    batchId: "lote-1",
    pieceNumber: seq,
    modelVersion: "1.0.0",
    predictedVerdict: "OK",
    confidence: 0.9,
    thresholdApplied: 0.25,
    inferenceMs: 120,
    warnings: [],
    capturedAt: new Date(2026, 10, 9, 10, 0, seq).toISOString(),
    attempts: 0,
    queuedAt: seq,
    ...overrides,
  };
}

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps & { saved: unknown[][] } {
  const saved: unknown[][] = [];
  return {
    saved,
    requestUploads: vi.fn(async (count: number) => ({
      ok: true as const,
      data: Array.from({ length: count }, (_, i) => ({ key: `empresa/2026/11/foto-${i}.jpg`, uploadUrl: `https://r2/${i}`, headers: {} })),
    })),
    upload: vi.fn(async () => {}),
    save: vi.fn(async (items: SyncPayload[]) => {
      saved.push(items);
      return { ok: true as const, data: items.map((item) => ({ clientId: item.clientId, ok: true as const })) };
    }),
    ...overrides,
  };
}

describe.each([
  ["memoria", async () => createMemoryQueue()],
  ["IndexedDB", async () => createIndexedDbQueue(new IDBFactory())],
])("cola local en %s (HU44-T05)", (_name, make: () => Promise<InspectionQueue>) => {
  it("guarda, ordena por llegada y continúa la numeración del lote", async () => {
    const queue = await make();
    const [a, b, c] = [pending(), pending(), pending({ batchId: "lote-2" })];
    await queue.add(b);
    await queue.add(a);
    await queue.add(c);
    expect((await queue.peek(2)).map((i) => i.clientId)).toEqual([a.clientId, b.clientId]);
    expect(await queue.size()).toBe(3);
    expect(await queue.maxPieceNumber("lote-1")).toBe(b.pieceNumber);
    await queue.reject(b, "El lote está cerrado");
    expect(await queue.size()).toBe(2);
    expect(await queue.rejectedSize()).toBe(1);
    expect(await queue.maxPieceNumber("lote-1")).toBe(b.pieceNumber);
    await queue.remove([a.clientId, c.clientId]);
    expect(await queue.size()).toBe(0);
  });

  it("conserva la foto como Blob", async () => {
    const queue = await make();
    const item = pending({ photo: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }) });
    await queue.add(item);
    const [stored] = await queue.peek(1);
    expect(stored.photo?.size).toBe(3);
  });
});

describe("envío por lotes (HU44-T05)", () => {
  it("se envía cada 5 s o al llegar a 50 pendientes", () => {
    expect(shouldFlush(0, 0, 60_000)).toBe(false);
    expect(shouldFlush(3, 0, 4_000)).toBe(false);
    expect(shouldFlush(3, 0, 5_000)).toBe(true);
    expect(shouldFlush(50, 4_000, 4_100)).toBe(true);
  });

  it("sube las fotos, registra las inspecciones y vacía la cola", async () => {
    const queue = createMemoryQueue();
    const photo = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    const ok = pending();
    const defective = pending({ predictedVerdict: "DEFECTIVE", photo });
    await queue.add(ok);
    await queue.add(defective);
    const remote = deps();

    expect(await flushQueue(queue, remote)).toEqual({ sent: 2, rejected: 0, retry: 0, offline: false });
    expect(remote.requestUploads).toHaveBeenCalledWith(1);
    expect(remote.upload).toHaveBeenCalledTimes(1);
    const [sent] = remote.saved as Record<string, unknown>[][];
    expect(sent[0]).toMatchObject({ clientId: ok.clientId, source: "LINE" });
    expect(sent[0]).not.toHaveProperty("imageKey");
    expect(sent[0]).not.toHaveProperty("photo");
    expect(sent[1]).toMatchObject({ clientId: defective.clientId, imageKey: "empresa/2026/11/foto-0.jpg" });
    expect(await queue.size()).toBe(0);
  });

  it("sin red no pierde nada: el lote queda para el siguiente intento", async () => {
    const queue = createMemoryQueue();
    await queue.add(pending());
    await queue.add(pending({ photo: new Blob([new Uint8Array([1])]) }));
    const offline = deps({ upload: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });

    expect(await flushQueue(queue, offline)).toEqual({ sent: 0, rejected: 0, retry: 2, offline: true });
    expect(await queue.size()).toBe(2);
    expect(await flushQueue(queue, deps())).toMatchObject({ sent: 2, offline: false });
    expect(await queue.size()).toBe(0);
  });

  it("los rechazos definitivos pasan a rechazadas y los temporales se reintentan", async () => {
    const queue = createMemoryQueue();
    const [closed, transient, fine] = [pending(), pending(), pending()];
    for (const item of [closed, transient, fine]) await queue.add(item);
    const remote = deps({
      save: vi.fn(async () => ({
        ok: true as const,
        data: [
          { clientId: closed.clientId, ok: false as const, code: "BATCH_CLOSED", message: "El lote está cerrado" },
          { clientId: transient.clientId, ok: false as const, code: "UNAVAILABLE", message: "Inténtalo de nuevo" },
          { clientId: fine.clientId, ok: true as const },
        ],
      })),
    });

    expect(await flushQueue(queue, remote)).toEqual({ sent: 1, rejected: 1, retry: 1, offline: false });
    expect(await queue.rejectedSize()).toBe(1);
    const [left] = await queue.peek(10);
    expect(left).toMatchObject({ clientId: transient.clientId, attempts: 1 });
  });

  it("sin almacenamiento de fotos envía sin foto (las defectuosas las rechaza el servidor)", async () => {
    const queue = createMemoryQueue();
    await queue.add(pending({ photo: new Blob([new Uint8Array([1])]) }));
    const remote = deps({
      requestUploads: vi.fn(async () => ({ ok: false as const, code: "STORAGE_NOT_CONFIGURED", message: "Sin R2" })),
    });
    expect(await flushQueue(queue, remote)).toMatchObject({ sent: 1 });
    expect(remote.upload).not.toHaveBeenCalled();
  });

  it("si el servidor no responde bien, reintenta el lote completo", async () => {
    const queue = createMemoryQueue();
    await queue.add(pending());
    const remote = deps({ save: vi.fn(async () => ({ ok: false as const, code: "UNAVAILABLE", message: "x" })) });
    expect(await flushQueue(queue, remote)).toEqual({ sent: 0, rejected: 0, retry: 1, offline: false });
    expect(await queue.size()).toBe(1);
  });
});
