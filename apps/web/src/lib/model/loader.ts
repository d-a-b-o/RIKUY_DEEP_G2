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
import { type ActiveModel, type Classification, classify, parseModelManifest, resolveActiveModel } from "./manifest";
import { resizeModelPixels } from "./preprocess";

export type Backend = "webgl" | "wasm" | "cpu";
export type LoadStage = "manifest" | "cache" | "download" | "backend" | "warmup";
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
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelLoadError";
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

async function selectBackend({ tf, wasm }: Tf): Promise<Backend> {
  if (await tf.setBackend("webgl").catch(() => false)) return "webgl";
  wasm.setWasmPaths(WASM_PATH);
  if (await tf.setBackend("wasm").catch(() => false)) return "wasm";
  await tf.setBackend("cpu");
  return "cpu";
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readRemembered(): ActiveModel | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ActiveModel) : null;
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

async function resolveActive(manifestUrl: string): Promise<{ active: ActiveModel; offline: boolean }> {
  try {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { active: resolveActiveModel(parseModelManifest(await response.json()), manifestUrl), offline: false };
  } catch (error) {
    const remembered = readRemembered();
    if (remembered) return { active: remembered, offline: true };
    throw new ModelLoadError("No se pudo leer el manifest de modelos y no hay ninguna versión guardada.", {
      cause: error,
    });
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

export async function loadInspectionModel(
  manifestUrl: string,
  onStage?: (stage: LoadStage, progress?: number) => void,
): Promise<InspectionModel> {
  const started = performance.now();
  onStage?.("manifest");
  const { active, offline } = await resolveActive(manifestUrl);

  const lib = await importTf();
  const { tf, converter } = lib;

  onStage?.("backend");
  const backend = await selectBackend(lib);
  await tf.ready();

  let model: Awaited<ReturnType<typeof converter.loadGraphModel>>;
  let source: ModelSource;
  try {
    onStage?.("cache");
    model = await converter.loadGraphModel(active.cacheKey);
    source = "cache";
  } catch {
    if (offline) {
      throw new ModelLoadError(`Sin conexión y la versión ${active.version} no está guardada en este equipo.`);
    }
    onStage?.("download", 0);
    if (active.modelSha256) {
      const response = await fetch(active.modelUrl);
      if (!response.ok) throw new ModelLoadError(`No se pudo descargar el modelo (HTTP ${response.status}).`);
      const hash = await sha256Hex(await response.arrayBuffer());
      if (hash !== active.modelSha256) {
        throw new ModelLoadError(`El modelo ${active.version} no coincide con el hash del manifest.`);
      }
    }
    model = await converter.loadGraphModel(active.modelUrl, {
      onProgress: (fraction) => onStage?.("download", fraction),
    });
    source = "network";
    await model.save(active.cacheKey).catch(() => undefined);
  }
  remember(active);
  await removeOldVersions(lib, active.cacheKey);

  // La primera inferencia compila los shaders de WebGL; no cuenta en las métricas.
  onStage?.("warmup");
  const { width, height } = active.input;
  tf.tidy(() => (model.predict(tf.zeros([1, height, width, 3])) as InstanceType<typeof tf.Tensor>).dataSync());

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
        const resized = resizeModelPixels(tf, pixels, active.input);
        const batch = tf.expandDims(tf.add(tf.mul(resized, active.input.scale), active.input.offset), 0);
        return model.predict(batch) as InstanceType<typeof tf.Tensor>;
      });
      try {
        const [defectProbability] = await output.data();
        return { ...classify(defectProbability, active.threshold), inferenceMs: performance.now() - begin };
      } finally {
        output.dispose();
      }
    },
    dispose() {
      model.dispose();
    },
  };
}
