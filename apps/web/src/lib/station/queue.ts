/**
 * Cola local de la estación (HU44-T05, RIKDP-272).
 *
 * Cada inspección se guarda primero en este equipo y un proceso en segundo
 * plano la envía al servidor en lotes (cada 5 s o cada 50 inspecciones). Si no
 * hay red, la cola crece y la estación sigue inspeccionando; al volver la red,
 * se vacía. El envío es idempotente: cada inspección lleva su `clientId`.
 *
 * Las que el servidor rechaza por un motivo que no se arregla reintentando (por
 * ejemplo, el lote se cerró) pasan a una lista aparte para no bloquear la cola.
 */

export const FLUSH_INTERVAL_MS = 5_000;
export const FLUSH_BATCH_SIZE = 50;
/** Por encima de este número de pendientes se avisa en pantalla de que falta red. */
export const QUEUE_WARNING_SIZE = 2_000;

export type PendingInspection = {
  clientId: string;
  batchId: string;
  pieceNumber: number;
  modelVersion: string;
  predictedVerdict: "OK" | "DEFECTIVE";
  confidence: number;
  thresholdApplied: number;
  inferenceMs: number;
  backend?: "WEBGL" | "WASM";
  warnings: string[];
  /** ISO 8601. */
  capturedAt: string;
  /** Foto JPEG, solo si se conserva (defectuosa o 1 de cada N OK). */
  photo?: Blob;
  attempts: number;
  queuedAt: number;
  /** Motivo del último rechazo, en la lista de rechazadas. */
  rejection?: string;
};

export interface InspectionQueue {
  add(item: PendingInspection): Promise<void>;
  /** Las más antiguas primero. */
  peek(limit: number): Promise<PendingInspection[]>;
  update(item: PendingInspection): Promise<void>;
  remove(clientIds: readonly string[]): Promise<void>;
  /** Mueve a rechazadas: no se reintentan. */
  reject(item: PendingInspection, reason: string): Promise<void>;
  size(): Promise<number>;
  rejectedSize(): Promise<number>;
  /** Número de pieza más alto guardado para el lote, para continuar la numeración. */
  maxPieceNumber(batchId: string): Promise<number>;
}

export function shouldFlush(pending: number, lastFlushAt: number, now: number): boolean {
  if (pending === 0) return false;
  return pending >= FLUSH_BATCH_SIZE || now - lastFlushAt >= FLUSH_INTERVAL_MS;
}

// ─── En memoria (pruebas y navegadores sin IndexedDB) ─────────────────────────

export function createMemoryQueue(): InspectionQueue {
  const pending = new Map<string, PendingInspection>();
  const rejected = new Map<string, PendingInspection>();
  const sorted = () => [...pending.values()].sort((a, b) => a.queuedAt - b.queuedAt);
  return {
    async add(item) {
      pending.set(item.clientId, item);
    },
    async peek(limit) {
      return sorted().slice(0, limit);
    },
    async update(item) {
      if (pending.has(item.clientId)) pending.set(item.clientId, item);
    },
    async remove(ids) {
      for (const id of ids) pending.delete(id);
    },
    async reject(item, reason) {
      pending.delete(item.clientId);
      rejected.set(item.clientId, { ...item, rejection: reason });
    },
    async size() {
      return pending.size;
    },
    async rejectedSize() {
      return rejected.size;
    },
    async maxPieceNumber(batchId) {
      let max = 0;
      for (const item of [...pending.values(), ...rejected.values()]) {
        if (item.batchId === batchId && item.pieceNumber > max) max = item.pieceNumber;
      }
      return max;
    },
  };
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

const DB_NAME = "rikuydeep-station";
const DB_VERSION = 1;
const PENDING = "pending";
const REJECTED = "rejected";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transacción cancelada"));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const name of [PENDING, REJECTED]) {
      if (!db.objectStoreNames.contains(name)) {
        const store = db.createObjectStore(name, { keyPath: "clientId" });
        store.createIndex("queuedAt", "queuedAt");
        store.createIndex("batchId", "batchId");
      }
    }
  };
  return request(open);
}

export async function createIndexedDbQueue(factory: IDBFactory = indexedDB): Promise<InspectionQueue> {
  const db = await openDatabase(factory);

  async function maxIn(storeName: string, batchId: string): Promise<number> {
    const items = await request(db.transaction(storeName).objectStore(storeName).index("batchId").getAll(batchId));
    return (items as PendingInspection[]).reduce((max, item) => Math.max(max, item.pieceNumber), 0);
  }

  return {
    async add(item) {
      const tx = db.transaction(PENDING, "readwrite");
      tx.objectStore(PENDING).put(item);
      await done(tx);
    },
    async peek(limit) {
      const index = db.transaction(PENDING).objectStore(PENDING).index("queuedAt");
      return (await request(index.getAll(null, limit))) as PendingInspection[];
    },
    async update(item) {
      const tx = db.transaction(PENDING, "readwrite");
      tx.objectStore(PENDING).put(item);
      await done(tx);
    },
    async remove(ids) {
      const tx = db.transaction(PENDING, "readwrite");
      const store = tx.objectStore(PENDING);
      for (const id of ids) store.delete(id);
      await done(tx);
    },
    async reject(item, reason) {
      const tx = db.transaction([PENDING, REJECTED], "readwrite");
      tx.objectStore(PENDING).delete(item.clientId);
      tx.objectStore(REJECTED).put({ ...item, rejection: reason });
      await done(tx);
    },
    async size() {
      return request(db.transaction(PENDING).objectStore(PENDING).count());
    },
    async rejectedSize() {
      return request(db.transaction(REJECTED).objectStore(REJECTED).count());
    },
    async maxPieceNumber(batchId) {
      return Math.max(await maxIn(PENDING, batchId), await maxIn(REJECTED, batchId));
    },
  };
}

// ─── Envío ────────────────────────────────────────────────────────────────────

export type UploadTarget = { key: string; uploadUrl: string; headers: Record<string, string> };

export type SyncItemResult = { clientId: string; ok: true } | { clientId: string; ok: false; code: string; message: string };

export type Remote<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export type SyncDeps = {
  requestUploads(count: number): Promise<Remote<UploadTarget[]>>;
  /** Sube la foto con la URL prefirmada. Lanza si no hay red. */
  upload(target: UploadTarget, photo: Blob): Promise<void>;
  save(items: SyncPayload[]): Promise<Remote<SyncItemResult[]>>;
};

/** Lo que se envía al servidor por cada inspección. */
export type SyncPayload = Omit<PendingInspection, "photo" | "attempts" | "queuedAt" | "rejection"> & {
  source: "LINE";
  imageKey?: string;
};

/** Errores del servidor que no cambian al reintentar: la inspección pasa a rechazadas. */
const PERMANENT = new Set(["INVALID", "FORBIDDEN", "NOT_FOUND", "BATCH_CLOSED", "NO_ACTIVE_SHIFT", "UNKNOWN_MODEL", "IMAGE_REQUIRED", "CONFLICT"]);

export type FlushResult = { sent: number; rejected: number; retry: number; offline: boolean };

function payloadOf(item: PendingInspection, imageKey?: string): SyncPayload {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se quitan los campos locales
  const { photo, attempts, queuedAt, rejection, ...rest } = item;
  return { ...rest, source: "LINE", ...(imageKey ? { imageKey } : {}) };
}

/**
 * Envía un lote de la cola. Primero sube las fotos a R2 y después registra las
 * inspecciones. Si la red falla, no se pierde nada: el lote se reintenta después.
 */
export async function flushQueue(queue: InspectionQueue, deps: SyncDeps, limit = FLUSH_BATCH_SIZE): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: 0, retry: 0, offline: false };
  const items = await queue.peek(limit);
  if (items.length === 0) return result;

  try {
    const withPhoto = items.filter((item) => item.photo);
    const keys = new Map<string, string>();
    let storageMissing = false;
    if (withPhoto.length > 0) {
      const uploads = await deps.requestUploads(withPhoto.length);
      if (uploads.ok) {
        for (const [i, item] of withPhoto.entries()) {
          const target = uploads.data[i];
          if (!target) break;
          await deps.upload(target, item.photo!);
          keys.set(item.clientId, target.key);
        }
      } else if (uploads.code === "STORAGE_NOT_CONFIGURED") {
        // Sin almacenamiento se envían sin foto: las OK se registran y las
        // defectuosas las rechaza el servidor, porque su foto es obligatoria.
        storageMissing = true;
      } else {
        result.retry = items.length;
        return result;
      }
    }

    // Una foto sin URL de subida espera al siguiente envío.
    const ready = items.filter((item) => !item.photo || storageMissing || keys.has(item.clientId));
    result.retry = items.length - ready.length;
    if (ready.length === 0) return result;

    const saved = await deps.save(ready.map((item) => payloadOf(item, keys.get(item.clientId))));
    if (!saved.ok) {
      result.retry = items.length;
      return result;
    }

    const byId = new Map(ready.map((item) => [item.clientId, item]));
    const done: string[] = [];
    for (const outcome of saved.data) {
      const item = byId.get(outcome.clientId);
      if (!item) continue;
      byId.delete(outcome.clientId);
      if (outcome.ok) {
        done.push(outcome.clientId);
        result.sent += 1;
      } else if (PERMANENT.has(outcome.code)) {
        await queue.reject(item, outcome.message);
        result.rejected += 1;
      } else {
        await queue.update({ ...item, attempts: item.attempts + 1 });
        result.retry += 1;
      }
    }
    // Las que el servidor no llegó a procesar se reintentan.
    result.retry += byId.size;
    await queue.remove(done);
    return result;
  } catch {
    result.offline = true;
    result.retry = items.length;
    return result;
  }
}
