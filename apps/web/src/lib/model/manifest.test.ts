import { describe, expect, it } from "vitest";
import { classify, ManifestError, parseModelManifest, resolveActiveModel } from "./manifest";

const version = (overrides: Record<string, unknown> = {}) => ({
  version: "1.0.0",
  modelPath: "v1.0.0/model.json",
  publishedAt: "2026-11-15T12:00:00Z",
  input: { width: 400, height: 400, channels: 3, scale: 1 / 255, offset: 0 },
  output: { activation: "sigmoid", positiveLabel: "DEFECTIVE", negativeLabel: "OK" },
  threshold: 0.2649,
  metrics: { testAccuracy: 0.9897, testDefectRecall: 0.9829 },
  ...overrides,
});

const manifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  activeVersion: "1.0.0",
  versions: [version()],
  ...overrides,
});

describe("parseModelManifest", () => {
  it("acepta el manifest del modelo actual (400×400, umbral 0,2649)", () => {
    const parsed = parseModelManifest(manifest());
    expect(parsed.activeVersion).toBe("1.0.0");
    expect(parsed.versions[0].input).toEqual({ width: 400, height: 400, channels: 3, scale: 1 / 255, offset: 0 });
    expect(parsed.versions[0].threshold).toBe(0.2649);
  });

  it("permite volver a una versión anterior cambiando activeVersion", () => {
    const parsed = parseModelManifest(
      manifest({
        activeVersion: "1.0.0",
        versions: [version(), version({ version: "1.1.0", modelPath: "v1.1.0/model.json", threshold: 0.3 })],
      }),
    );
    expect(parsed.activeVersion).toBe("1.0.0");
    expect(parsed.versions).toHaveLength(2);
  });

  it.each([
    ["raíz que no es objeto", null],
    ["schemaVersion desconocida", manifest({ schemaVersion: 2 })],
    ["sin versiones", manifest({ versions: [] })],
    ["activeVersion inexistente", manifest({ activeVersion: "9.9.9" })],
    ["versión repetida", manifest({ versions: [version(), version()] })],
    ["versión sin formato X.Y.Z", manifest({ activeVersion: "v1", versions: [version({ version: "v1" })] })],
    ["modelPath absoluto", manifest({ versions: [version({ modelPath: "https://evil.example/model.json" })] })],
    ["modelPath que sube de carpeta", manifest({ versions: [version({ modelPath: "../model.json" })] })],
    ["modelPath que no es model.json", manifest({ versions: [version({ modelPath: "v1.0.0/weights.bin" })] })],
    ["sha256 mal formado", manifest({ versions: [version({ modelSha256: "abc" })] })],
    ["fecha inválida", manifest({ versions: [version({ publishedAt: "ayer" })] })],
    ["canales distintos de 3", manifest({ versions: [version({ input: { width: 400, height: 400, channels: 1, scale: 1, offset: 0 } })] })],
    ["tamaño no entero", manifest({ versions: [version({ input: { width: 400.5, height: 400, channels: 3, scale: 1, offset: 0 } })] })],
    ["escala negativa", manifest({ versions: [version({ input: { width: 400, height: 400, channels: 3, scale: -1, offset: 0 } })] })],
    ["salida softmax", manifest({ versions: [version({ output: { activation: "softmax", positiveLabel: "DEFECTIVE", negativeLabel: "OK" } })] })],
    ["umbral 0", manifest({ versions: [version({ threshold: 0 })] })],
    ["umbral mayor que 1", manifest({ versions: [version({ threshold: 1.2 })] })],
  ])("rechaza %s", (_name, raw) => {
    expect(() => parseModelManifest(raw)).toThrow(ManifestError);
  });
});

describe("resolveActiveModel", () => {
  it("resuelve la URL del modelo relativa al manifest y la clave de caché", () => {
    const active = resolveActiveModel(parseModelManifest(manifest()), "https://models.rikuydeep.app/manifest.json");
    expect(active.modelUrl).toBe("https://models.rikuydeep.app/v1.0.0/model.json");
    expect(active.cacheKey).toBe("indexeddb://rikuydeep-model-1.0.0");
  });
});

describe("classify", () => {
  const threshold = 0.2649;

  it("marca DEFECTIVE cuando la probabilidad alcanza el umbral", () => {
    expect(classify(0.2649, threshold).verdict).toBe("DEFECTIVE");
    expect(classify(0.97, threshold)).toMatchObject({ verdict: "DEFECTIVE", confidence: 0.97 });
  });

  it("marca OK por debajo del umbral, con confianza 1 − p", () => {
    const result = classify(0.1, threshold);
    expect(result.verdict).toBe("OK");
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.thresholdApplied).toBe(threshold);
  });

  it("con umbral bajo, una probabilidad de 0,30 ya es defectuosa", () => {
    expect(classify(0.3, threshold)).toMatchObject({ verdict: "DEFECTIVE", confidence: 0.3 });
  });

  it.each([[-0.1], [1.1], [Number.NaN]])("rechaza la probabilidad %s", (p) => {
    expect(() => classify(p, threshold)).toThrow(RangeError);
  });

  it.each([[0], [1], [Number.NaN]])("rechaza el umbral %s", (t) => {
    expect(() => classify(0.5, t)).toThrow(RangeError);
  });
});
