/**
 * Carga del modelo TF.js en el navegador (HU26 · RIKDP-155 y RIKDP-157).
 *
 * Flujo (docs/arquitectura/inferencia-navegador.md, «Flujo de carga»):
 * manifest sin caché → versión activa → IndexedDB o descarga con verificación
 * de hash → backend WebGL, si no WASM, si no CPU → calentamiento.
 *
 * Solo para el navegador. TensorFlow.js se importa al cargar, no al importar
 * este módulo, para que no pese en el resto de páginas.
 */
import {
  type ActiveModel,
  type Classification,
  classify,
  parseModelManifest,
  resolveActiveModel,
  ManifestError,
} from "./manifest";

export type Backend = "webgl" | "wasm" | "cpu";
export type LoadStage =
  | "manifest"
  | "cache"
  | "download"
  | "backend"
  | "warmup";
export type ModelSource = "cache" | "network";

export type LoadedModelInfo = {
  version: string;
  threshold: number;
  input: ActiveModel["input"];
  backend: Backend;
  source: ModelSource;
  /** El manifest no respondió y se usó la última versión guardada. */
  offline: boolean;
  loadMs: number;
};

export type Prediction = Classification & { inferenceMs: number };

export type InspectionModel = {
  info: LoadedModelInfo;
  /** Ejecuta el modelo sobre un canvas ya preparado con drawModelInput(). */
  predict(input: HTMLCanvasElement): Promise<Prediction>;
  dispose(): void;
};

const ACTIVE_KEY = "rikuydeep-model-active";
const CACHE_PREFIX = "indexeddb://rikuydeep-model-";
const WASM_PATH = "/tfjs-wasm/";

export class ModelLoadError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options);
    this.name = "ModelLoadError";
    this.retryable = options?.retryable ?? true;
  }
  readonly retryable: boolean;
}

/** Only these controlled messages reach the UI; causes may contain URLs or driver details. */
export function modelLoadFailure(error: unknown): ModelLoadError {
  return error instanceof ModelLoadError
    ? error
    : new ModelLoadError(
        "No se pudo preparar el modelo. Vuelve a intentarlo; si continúa, contacta al responsable de tu planta.",
        { cause: error },
      );
}

function deadline<T>(
  work: Promise<T>,
  ms: number,
  failure: ModelLoadError,
  late?: (value: T) => void,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      onTimeout?.();
      reject(failure);
    }, ms);
    work.then(
      (value) => {
        if (expired) late?.(value);
        else {
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Include the response body in the deadline, including stalled weight shards.
    const response = await fetch(url, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal,
    });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function importTf() {
  const [tf, converter, wasm] = await Promise.all([
    import("@tensorflow/tfjs-core"),
    import("@tensorflow/tfjs-converter"),
    import("@tensorflow/tfjs-backend-wasm"),
    import("@tensorflow/tfjs-backend-webgl"),
  ]);
  return { tf, converter, wasm };
}

type Tf = Awaited<ReturnType<typeof importTf>>;

const backends: Backend[] = ["webgl", "wasm", "cpu"];
let backendPending = false;
async function selectBackend(
  { tf, wasm }: Tf,
  after?: Backend,
): Promise<Backend> {
  if (backendPending)
    throw new ModelLoadError(
      "El navegador todavía está preparando la aceleración. Prueba con otro navegador compatible.",
      { retryable: false },
    );
  for (const backend of backends.slice(
    after ? backends.indexOf(after) + 1 : 0,
  )) {
    try {
      if (backend === "wasm") wasm.setWasmPaths(WASM_PATH);
      backendPending = true;
      const available = await deadline(
        (async () => {
          if (!(await tf.setBackend(backend))) return false;
          await tf.ready();
          return true;
        })().finally(() => {
          backendPending = false;
        }),
        20_000,
        new ModelLoadError(
          "El navegador no responde al preparar la aceleración. Prueba con otro navegador compatible o consulta al responsable de tu equipo.",
          { retryable: false },
        ),
      );
      if (available) return backend;
    } catch (error) {
      // A timed-out backend cannot be cancelled by TF.js: do not start another in parallel.
      if (error instanceof ModelLoadError) throw error;
    }
  }
  throw new ModelLoadError(
    "Este navegador no pudo preparar la inspección. Activa la aceleración gráfica y reintenta, o prueba con otro navegador compatible.",
  );
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function readRemembered(manifestUrl: string): ActiveModel | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    const active = resolveActiveModel(
      parseModelManifest({
        schemaVersion: 1,
        activeVersion: stored.version,
        versions: [stored],
      }),
      manifestUrl,
    );
    // Never reuse a model from another manifest/environment.
    return active.modelUrl === stored.modelUrl &&
      active.cacheKey === stored.cacheKey
      ? active
      : null;
  } catch {
    return null;
  }
}

function remember(active: ActiveModel) {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
  } catch {
    // Sin almacenamiento (modo privado): solo se pierde el modo sin conexión.
  }
}

async function resolveActive(
  manifestUrl: string,
): Promise<{ active: ActiveModel; offline: boolean }> {
  try {
    const response = await fetchWithTimeout(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      active: resolveActiveModel(
        parseModelManifest(await response.json()),
        manifestUrl,
      ),
      offline: false,
    };
  } catch (error) {
    if (error instanceof ManifestError || error instanceof SyntaxError) {
      throw new ModelLoadError(
        "La configuración del modelo no es válida. Contacta al responsable de tu planta para que la corrija.",
        { cause: error, retryable: false },
      );
    }
    const remembered = readRemembered(manifestUrl);
    if (remembered) return { active: remembered, offline: true };
    throw new ModelLoadError(
      "No se pudo consultar la versión del modelo y no hay una copia válida guardada. Comprueba tu conexión y vuelve a intentarlo.",
      {
        cause: error,
      },
    );
  }
}

/** Borra de IndexedDB las versiones que ya no son la activa. */
async function removeOldVersions({ tf }: Tf, keep: string) {
  const models = await tf.io.listModels().catch(() => ({}));
  await Promise.all(
    Object.keys(models)
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== keep)
      .map((key) => tf.io.removeModel(key).catch(() => undefined)),
  );
}

async function initializeInspectionModel(
  manifestUrl: string,
  onStage?: (stage: LoadStage, progress?: number) => void,
): Promise<InspectionModel> {
  const started = performance.now();
  onStage?.("manifest");
  const { active, offline } = await resolveActive(manifestUrl);

  const engineMessage =
    "No se pudo iniciar el motor de inspección. Comprueba tu conexión y vuelve a intentarlo.";
  const lib = await deadline(
    importTf(),
    30_000,
    new ModelLoadError(engineMessage),
  ).catch((error) => {
    throw new ModelLoadError(engineMessage, { cause: error });
  });
  const { tf, converter } = lib;

  onStage?.("backend");
  let backend = await selectBackend(lib);

  let model: Awaited<ReturnType<typeof converter.loadGraphModel>> | undefined;
  let source: ModelSource;
  try {
    try {
      onStage?.("cache");
      model = await deadline(
        converter.loadGraphModel(active.cacheKey),
        10_000,
        new ModelLoadError("No se pudo abrir la copia guardada del modelo."),
        (late) => late.dispose(),
      );
      source = "cache";
    } catch {
      if (offline) {
        throw new ModelLoadError(
          "Sin conexión y sin una copia válida del modelo en este equipo. Conéctate a Internet y vuelve a intentarlo.",
        );
      }
      onStage?.("download", 0);
      let verifiedModel: Response | undefined;
      if (active.modelSha256) {
        const response = await fetchWithTimeout(active.modelUrl);
        if (!response.ok)
          throw new ModelLoadError(
            "No se pudo descargar el modelo. Comprueba tu conexión y vuelve a intentarlo.",
          );
        verifiedModel = response.clone();
        const hash = await sha256Hex(await response.arrayBuffer());
        if (hash !== active.modelSha256) {
          throw new ModelLoadError(
            "La copia publicada del modelo no superó la verificación. Contacta al responsable de tu planta.",
            { retryable: false },
          );
        }
      }
      const downloadController = new AbortController();
      model = await deadline(
        converter.loadGraphModel(active.modelUrl, {
          requestInit: { signal: downloadController.signal },
          fetchFunc: (url, init) =>
            String(url) === active.modelUrl && verifiedModel
              ? Promise.resolve(verifiedModel.clone())
              : fetchWithTimeout(String(url), init),
          onProgress: (fraction) => onStage?.("download", fraction),
        }),
        120_000,
        new ModelLoadError(
          "La descarga tardó demasiado. Comprueba tu conexión y vuelve a intentarlo.",
        ),
        (late) => late.dispose(),
        () => downloadController.abort(),
      ).catch((error) => {
        downloadController.abort();
        throw error instanceof ModelLoadError
          ? error
          : new ModelLoadError(
              "No se pudo descargar o leer el modelo. Comprueba tu conexión y vuelve a intentarlo.",
              { cause: error },
            );
      });
      source = "network";
    }

    // La primera inferencia compila los shaders de WebGL; no cuenta en las métricas.
    const { width, height } = active.input;
    for (;;) {
      onStage?.("warmup");
      try {
        tf.tidy(() =>
          (
            model!.predict(tf.zeros([1, height, width, 3])) as InstanceType<
              typeof tf.Tensor
            >
          ).dataSync(),
        );
        break;
      } catch {
        onStage?.("backend");
        backend = await selectBackend(lib, backend);
      }
    }
    if (source === "network") {
      // Cache only a model that warmed up successfully. Storage is optional.
      await deadline(
        model.save(active.cacheKey),
        10_000,
        new ModelLoadError("No se pudo guardar la copia local."),
      ).catch(() => undefined);
    }
    remember(active);
    void removeOldVersions(lib, active.cacheKey).catch(() => undefined);
  } catch (error) {
    model?.dispose();
    throw modelLoadFailure(error);
  }
  const loaded = model;

  const info: LoadedModelInfo = {
    version: active.version,
    threshold: active.threshold,
    input: active.input,
    backend,
    source,
    offline,
    loadMs: Math.round(performance.now() - started),
  };

  return {
    info,
    async predict(canvas) {
      const begin = performance.now();
      const output = tf.tidy(() => {
        const pixels = tf.cast(tf.browser.fromPixels(canvas, 3), "float32");
        const batch = tf.expandDims(
          tf.add(tf.mul(pixels, active.input.scale), active.input.offset),
          0,
        );
        return loaded.predict(batch) as InstanceType<typeof tf.Tensor>;
      });
      try {
        const [defectProbability] = await output.data();
        return {
          ...classify(defectProbability, active.threshold),
          inferenceMs: performance.now() - begin,
        };
      } finally {
        output.dispose();
      }
    },
    dispose() {
      loaded.dispose();
    },
  };
}

type StageListener = (stage: LoadStage, progress?: number) => void;
type Session = {
  promise: Promise<InspectionModel>;
  users: number;
  listeners: Set<StageListener>;
  stage: LoadStage;
  progress?: number;
};
const sessions = new Map<string, Session>();
// TF.js backends are global: initialize sequentially, even for different URLs.
let initialization: Promise<unknown> = Promise.resolve();

/** Shared initialization with independent, idempotent ownership (also handles React Strict Mode). */
export async function loadInspectionModel(
  manifestUrl: string,
  onStage?: StageListener,
): Promise<InspectionModel> {
  let session = sessions.get(manifestUrl);
  if (!session) {
    const created: Session = {
      promise: undefined!,
      users: 0,
      listeners: new Set(),
      stage: "manifest",
    };
    const start = () =>
      initializeInspectionModel(manifestUrl, (stage, progress) => {
        created.stage = stage;
        created.progress = progress;
        created.listeners.forEach((listener) => listener(stage, progress));
      });
    created.promise = initialization.then(start).catch((error) => {
      sessions.delete(manifestUrl);
      throw modelLoadFailure(error);
    });
    initialization = created.promise.catch(() => undefined);
    sessions.set(manifestUrl, created);
    session = created;
  }
  const shared = session;
  shared.users++;
  if (onStage) {
    shared.listeners.add(onStage);
    onStage(shared.stage, shared.progress);
  }
  let model: InspectionModel;
  try {
    model = await shared.promise;
  } catch (error) {
    if (onStage) shared.listeners.delete(onStage);
    throw error;
  }
  let disposed = false;
  return {
    ...model,
    predict(input) {
      if (disposed)
        return Promise.reject(
          new ModelLoadError(
            "El modelo ya no está disponible. Vuelve a abrir la inspección.",
          ),
        );
      return model.predict(input);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (onStage) shared.listeners.delete(onStage);
      if (--shared.users === 0) {
        sessions.delete(manifestUrl);
        model.dispose();
      }
    },
  };
}
