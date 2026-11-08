import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveActiveModel, parseModelManifest } from "./manifest";

const mocks = vi.hoisted(() => ({
  setBackend: vi.fn(),
  ready: vi.fn(),
  load: vi.fn(),
  paths: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@tensorflow/tfjs-core", () => ({
  setBackend: mocks.setBackend,
  ready: mocks.ready,
  tidy: (fn: () => unknown) => fn(),
  zeros: vi.fn(),
  io: { listModels: mocks.list, removeModel: mocks.remove },
}));
vi.mock("@tensorflow/tfjs-converter", () => ({ loadGraphModel: mocks.load }));
vi.mock("@tensorflow/tfjs-backend-wasm", () => ({ setWasmPaths: mocks.paths }));
vi.mock("@tensorflow/tfjs-backend-webgl", () => ({}));

const url = "https://models.example/dev/manifest.json";
const version = {
  version: "1.0.0",
  modelPath: "v1.0.0/model.json",
  publishedAt: "2026-11-01T00:00:00Z",
  input: { width: 400, height: 400, channels: 3, scale: 1 / 255, offset: 0 },
  output: {
    activation: "sigmoid",
    positiveLabel: "DEFECTIVE",
    negativeLabel: "OK",
  },
  threshold: 0.2649,
};
const manifest = {
  schemaVersion: 1,
  activeVersion: version.version,
  versions: [version],
};
const cacheKey = "indexeddb://rikuydeep-model-1.0.0";
const graph = () => ({
  predict: vi.fn(() => ({ dataSync: vi.fn(() => [0.1]) })),
  save: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
});
let model: ReturnType<typeof graph>;
let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let loader: typeof import("./loader");

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  model = graph();
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  fetchMock = vi.fn().mockImplementation(async () => Response.json(manifest));
  vi.stubGlobal("fetch", fetchMock);
  mocks.setBackend.mockResolvedValue(true);
  mocks.ready.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue({});
  mocks.remove.mockResolvedValue(undefined);
  mocks.load.mockImplementation(async (key: string) => {
    if (key.startsWith("indexeddb:")) throw new Error("cache miss");
    return model;
  });
  loader = await import("./loader");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("inicialización y recuperación TF.js · RIKDP-287", () => {
  it("emite etapas, calienta, guarda y conserva la configuración del modelo", async () => {
    const stages = vi.fn();
    const loaded = await loader.loadInspectionModel(url, stages);
    expect(loaded.info).toMatchObject({
      version: "1.0.0",
      threshold: 0.2649,
      source: "network",
      backend: "webgl",
      offline: false,
    });
    expect(stages.mock.calls.map(([stage]) => stage)).toEqual([
      "manifest",
      "manifest",
      "backend",
      "cache",
      "download",
      "warmup",
    ]);
    expect(model.predict).toHaveBeenCalledOnce();
    expect(model.save).toHaveBeenCalledWith(cacheKey);
    expect(storage.has("rikuydeep-model-active")).toBe(true);
    loaded.dispose();
    expect(model.dispose).toHaveBeenCalledOnce();
  });
  it("reutiliza IndexedDB sin descargar ni guardar de nuevo", async () => {
    mocks.load.mockResolvedValue(model);
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info.source).toBe("cache");
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(cacheKey);
    expect(model.save).not.toHaveBeenCalled();
    loaded.dispose();
  });
  it("usa caché offline solo con metadatos validados", async () => {
    storage.set(
      "rikuydeep-model-active",
      JSON.stringify(resolveActiveModel(parseModelManifest(manifest), url)),
    );
    fetchMock.mockRejectedValue(new Error("network internal secret"));
    mocks.load.mockResolvedValue(model);
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info).toMatchObject({ offline: true, source: "cache" });
    loaded.dispose();
  });
  it.each(["{}", "invalid json"])(
    "descarta metadatos corruptos: %s",
    async (raw) => {
      storage.set("rikuydeep-model-active", raw);
      fetchMock.mockRejectedValue(new Error("private address"));
      await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
        retryable: true,
        message: expect.stringContaining("conexión"),
      });
      expect(mocks.load).not.toHaveBeenCalled();
    },
  );
  it("no reutiliza metadatos guardados desde otro entorno", async () => {
    storage.set(
      "rikuydeep-model-active",
      JSON.stringify(
        resolveActiveModel(
          parseModelManifest(manifest),
          "https://other.example/manifest.json",
        ),
      ),
    );
    fetchMock.mockRejectedValue(new Error("network"));
    await expect(loader.loadInspectionModel(url)).rejects.toBeInstanceOf(
      loader.ModelLoadError,
    );
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("manifest inválido exige corregir configuración y no muestra valores internos", async () => {
    fetchMock.mockResolvedValue(Response.json({ schemaVersion: "SECRET" }));
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("configuración"),
    });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("manifest HTTP fallido permite reintentar y recuperarse", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("internal token", { status: 503 }),
    );
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      retryable: true,
    });
    const loaded = await loader.loadInspectionModel(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loaded.info.source).toBe("network");
    loaded.dispose();
  });
  it("reintento fallido conserva un error seguro y permite otra tentativa", async () => {
    fetchMock.mockRejectedValue(new Error("https://private/?secret=123"));
    for (let i = 0; i < 2; i++) {
      await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
        message: expect.not.stringContaining("secret"),
        retryable: true,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("descarga fallida no guarda ni recuerda un modelo incompleto", async () => {
    mocks.load.mockRejectedValue(new Error("private shard url"));
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      retryable: true,
      message: expect.not.stringContaining("private"),
    });
    expect(storage.size).toBe(0);
    expect(model.save).not.toHaveBeenCalled();
  });
  it("fallo de una descarga cancela las peticiones hermanas antes de permitir otro intento", async () => {
    let signal!: AbortSignal;
    mocks.load
      .mockRejectedValueOnce(new Error("cache miss"))
      .mockImplementationOnce((_url, options) => {
        signal = options.requestInit.signal;
        return Promise.reject(new Error("shard unavailable"));
      });
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      retryable: true,
    });
    expect(signal.aborted).toBe(true);
  });
  it("selecciona WASM si falla WebGL, sin recargar el modelo", async () => {
    mocks.setBackend.mockResolvedValueOnce(false).mockResolvedValue(true);
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info.backend).toBe("wasm");
    expect(mocks.paths).toHaveBeenCalledWith("/tfjs-wasm/");
    loaded.dispose();
  });
  it("fallo de tf.ready en WebGL también activa el fallback", async () => {
    mocks.ready.mockRejectedValueOnce(new Error("driver"));
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info.backend).toBe("wasm");
    loaded.dispose();
  });
  it("mantiene CPU como última alternativa si fallan WebGL y WASM", async () => {
    mocks.setBackend
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("wasm failed"))
      .mockResolvedValue(true);
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info.backend).toBe("cpu");
    loaded.dispose();
  });
  it("todos los backends fallidos muestran acción y permiten recuperación posterior", async () => {
    mocks.setBackend.mockResolvedValue(false);
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      message: expect.stringContaining("otro navegador"),
      retryable: true,
    });
    mocks.setBackend.mockResolvedValue(true);
    const loaded = await loader.loadInspectionModel(url);
    loaded.dispose();
  });
  it("fallback durante calentamiento reutiliza el modelo ya descargado", async () => {
    model.predict.mockImplementationOnce(() => {
      throw new Error("WebGL lost");
    });
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info.backend).toBe("wasm");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(model.predict).toHaveBeenCalledTimes(2);
    loaded.dispose();
  });
  it("libera el modelo si ningún backend puede calentarlo", async () => {
    model.predict.mockImplementation(() => {
      throw new Error("kernel failed");
    });
    await expect(loader.loadInspectionModel(url)).rejects.toBeInstanceOf(
      loader.ModelLoadError,
    );
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(model.save).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });
  it("almacenamiento bloqueado no impide la inspección", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error();
      },
      setItem: () => {
        throw new Error();
      },
    });
    model.save.mockRejectedValue(new Error("quota"));
    const loaded = await loader.loadInspectionModel(url);
    expect(loaded.info.source).toBe("network");
    loaded.dispose();
  });
  it("cargas simultáneas comparten descarga y liberan solo al último consumidor", async () => {
    const [first, second] = await Promise.all([
      loader.loadInspectionModel(url),
      loader.loadInspectionModel(url),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    first.dispose();
    first.dispose();
    expect(model.dispose).not.toHaveBeenCalled();
    await expect(first.predict({} as HTMLCanvasElement)).rejects.toBeInstanceOf(
      loader.ModelLoadError,
    );
    second.dispose();
    expect(model.dispose).toHaveBeenCalledOnce();
  });
  it("serializa inicializaciones de distintos manifests por el backend global", async () => {
    let release!: () => void;
    mocks.ready.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = loader.loadInspectionModel(url);
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce());
    const second = loader.loadInspectionModel(
      "https://models.example/other/manifest.json",
    );
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    release();
    const leases = await Promise.all([first, second]);
    leases.forEach((lease) => lease.dispose());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("backend colgado termina con acción concreta e impide inicializaciones solapadas", async () => {
    vi.useFakeTimers();
    mocks.setBackend.mockReturnValue(new Promise(() => {}));
    const pending = loader.loadInspectionModel(url);
    const rejected = expect(pending).rejects.toMatchObject({
      retryable: false,
    });
    await vi.advanceTimersByTimeAsync(20_001);
    await rejected;
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      retryable: false,
    });
    expect(mocks.setBackend).toHaveBeenCalledOnce();
  });
  it("caché colgada libera una respuesta tardía y permite descargar", async () => {
    vi.useFakeTimers();
    let release!: (value: ReturnType<typeof graph>) => void;
    const late = graph();
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = loader.loadInspectionModel(url);
    await vi.advanceTimersByTimeAsync(10_001);
    const loaded = await pending;
    release(late);
    await Promise.resolve();
    expect(late.dispose).toHaveBeenCalledOnce();
    loaded.dispose();
  });
  it("nunca entrega el modelo antes del calentamiento", async () => {
    let release!: (value: ReturnType<typeof graph>) => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const consumer = vi.fn();
    const pending = loader.loadInspectionModel(url).then(consumer);
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    expect(consumer).not.toHaveBeenCalled();
    release(model);
    await pending;
    expect(model.predict).toHaveBeenCalledOnce();
    consumer.mock.calls[0][0].dispose();
  });
  it("manifest sin respuesta se cancela y permite un reintento", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = loader.loadInspectionModel(url);
    const rejected = expect(pending).rejects.toMatchObject({ retryable: true });
    await vi.advanceTimersByTimeAsync(30_001);
    await rejected;
    const loaded = await loader.loadInspectionModel(url);
    loaded.dispose();
  });
  it("descarga colgada se cancela y libera cualquier modelo tardío", async () => {
    vi.useFakeTimers();
    let release!: (value: ReturnType<typeof graph>) => void;
    mocks.load
      .mockRejectedValueOnce(new Error("cache miss"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    const pending = loader.loadInspectionModel(url);
    const rejected = expect(pending).rejects.toMatchObject({
      retryable: true,
      message: expect.stringContaining("tardó demasiado"),
    });
    await vi.advanceTimersByTimeAsync(120_001);
    await rejected;
    expect(mocks.load.mock.calls[1][1].requestInit.signal.aborted).toBe(true);
    release(model);
    await Promise.resolve();
    expect(model.dispose).toHaveBeenCalledOnce();
  });
  it("hash incorrecto impide ejecutar o guardar el modelo", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          ...manifest,
          versions: [{ ...version, modelSha256: "0".repeat(64) }],
        }),
      )
      .mockResolvedValueOnce(Response.json({}));
    await expect(loader.loadInspectionModel(url)).rejects.toMatchObject({
      retryable: false,
    });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(cacheKey);
    expect(model.save).not.toHaveBeenCalled();
  });
  it("hash verificado reutiliza model.json en la carga en lugar de descargarlo dos veces", async () => {
    const json = "{}";
    const hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)),
    ).toString("hex");
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          ...manifest,
          versions: [{ ...version, modelSha256: hash }],
        }),
      )
      .mockResolvedValueOnce(new Response(json));
    mocks.load
      .mockRejectedValueOnce(new Error("cache miss"))
      .mockImplementationOnce(async (modelUrl, options) => {
        expect(await (await options.fetchFunc(modelUrl)).text()).toBe(json);
        return model;
      });
    const loaded = await loader.loadInspectionModel(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    loaded.dispose();
  });
});
