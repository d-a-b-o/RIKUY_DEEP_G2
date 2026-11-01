/**
 * Manifest de modelos de RikuyDeep.
 *
 * Indica qué versión del modelo TF.js debe cargar el navegador y cómo
 * preprocesar las imágenes para esa versión. Diseño completo en
 * docs/arquitectura/inferencia-navegador.md (RIKDP-88).
 */

export const MANIFEST_SCHEMA_VERSION = 1;

export type Verdict = "OK" | "DEFECTIVE";

export type ModelInputSpec = {
  width: number;
  height: number;
  channels: 3;
  /** Normalización que aplica la web: valor = píxel × scale + offset. */
  scale: number;
  offset: number;
};

export type ModelOutputSpec = {
  activation: "sigmoid";
  positiveLabel: "DEFECTIVE";
  negativeLabel: "OK";
};

export type ModelVersion = {
  version: string;
  /** Ruta a model.json, relativa a la URL del manifest. */
  modelPath: string;
  modelSha256?: string;
  publishedAt: string;
  input: ModelInputSpec;
  output: ModelOutputSpec;
  /** Umbral de decisión sobre la probabilidad de defecto, en [0, 1]. */
  threshold: number;
  metrics?: {
    testAccuracy?: number;
    testDefectRecall?: number;
    mlflowRunId?: string;
  };
};

export type ModelManifest = {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  activeVersion: string;
  versions: ModelVersion[];
};

export class ManifestError extends Error {
  constructor(message: string) {
    super(`Manifest de modelos inválido: ${message}`);
    this.name = "ManifestError";
  }
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseVersion(raw: unknown, index: number): ModelVersion {
  const where = `versions[${index}]`;
  if (!isRecord(raw)) throw new ManifestError(`${where} no es un objeto`);

  const { version, modelPath, modelSha256, publishedAt, input, output, threshold, metrics } = raw;

  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new ManifestError(`${where}.version debe tener formato X.Y.Z`);
  }
  if (typeof modelPath !== "string" || !modelPath.endsWith("model.json")) {
    throw new ManifestError(`${where}.modelPath debe apuntar a un model.json`);
  }
  if (/^[a-z]+:\/\//i.test(modelPath) || modelPath.startsWith("/") || modelPath.includes("..")) {
    throw new ManifestError(`${where}.modelPath debe ser una ruta relativa al manifest`);
  }
  if (modelSha256 !== undefined && (typeof modelSha256 !== "string" || !SHA256.test(modelSha256))) {
    throw new ManifestError(`${where}.modelSha256 debe ser un SHA-256 en hexadecimal`);
  }
  if (typeof publishedAt !== "string" || Number.isNaN(Date.parse(publishedAt))) {
    throw new ManifestError(`${where}.publishedAt debe ser una fecha ISO 8601`);
  }

  if (!isRecord(input)) throw new ManifestError(`${where}.input no es un objeto`);
  if (!isPositiveInteger(input.width) || !isPositiveInteger(input.height)) {
    throw new ManifestError(`${where}.input.width y height deben ser enteros positivos`);
  }
  if (input.channels !== 3) throw new ManifestError(`${where}.input.channels debe ser 3 (RGB)`);
  if (!isFiniteNumber(input.scale) || input.scale <= 0 || !isFiniteNumber(input.offset)) {
    throw new ManifestError(`${where}.input.scale debe ser positivo y offset un número`);
  }

  if (
    !isRecord(output) ||
    output.activation !== "sigmoid" ||
    output.positiveLabel !== "DEFECTIVE" ||
    output.negativeLabel !== "OK"
  ) {
    throw new ManifestError(`${where}.output debe ser sigmoid con etiquetas DEFECTIVE / OK`);
  }

  if (!isFiniteNumber(threshold) || threshold <= 0 || threshold >= 1) {
    throw new ManifestError(`${where}.threshold debe estar entre 0 y 1`);
  }

  if (metrics !== undefined && !isRecord(metrics)) {
    throw new ManifestError(`${where}.metrics no es un objeto`);
  }

  return {
    version,
    modelPath,
    ...(modelSha256 === undefined ? {} : { modelSha256 }),
    publishedAt,
    input: {
      width: input.width,
      height: input.height,
      channels: 3,
      scale: input.scale,
      offset: input.offset,
    },
    output: { activation: "sigmoid", positiveLabel: "DEFECTIVE", negativeLabel: "OK" },
    threshold,
    ...(metrics === undefined ? {} : { metrics: metrics as ModelVersion["metrics"] }),
  };
}

/** Valida el JSON descargado y devuelve un manifest tipado, o lanza ManifestError. */
export function parseModelManifest(raw: unknown): ModelManifest {
  if (!isRecord(raw)) throw new ManifestError("la raíz no es un objeto");
  if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new ManifestError(`schemaVersion ${String(raw.schemaVersion)} no soportada (se espera ${MANIFEST_SCHEMA_VERSION})`);
  }
  if (!Array.isArray(raw.versions) || raw.versions.length === 0) {
    throw new ManifestError("versions debe ser una lista con al menos una versión");
  }

  const versions = raw.versions.map(parseVersion);
  const seen = new Set<string>();
  for (const { version } of versions) {
    if (seen.has(version)) throw new ManifestError(`la versión ${version} está repetida`);
    seen.add(version);
  }

  if (typeof raw.activeVersion !== "string" || !seen.has(raw.activeVersion)) {
    throw new ManifestError(`activeVersion ${String(raw.activeVersion)} no está en versions`);
  }

  return { schemaVersion: MANIFEST_SCHEMA_VERSION, activeVersion: raw.activeVersion, versions };
}

export type ActiveModel = ModelVersion & {
  /** URL absoluta de model.json. */
  modelUrl: string;
  /** Clave de caché en IndexedDB para esta versión. */
  cacheKey: string;
};

/** Devuelve la versión activa con la URL absoluta del modelo y su clave de caché. */
export function resolveActiveModel(manifest: ModelManifest, manifestUrl: string): ActiveModel {
  const active = manifest.versions.find((v) => v.version === manifest.activeVersion);
  if (!active) throw new ManifestError(`activeVersion ${manifest.activeVersion} no está en versions`);
  return {
    ...active,
    modelUrl: new URL(active.modelPath, manifestUrl).toString(),
    cacheKey: `indexeddb://rikuydeep-model-${active.version}`,
  };
}

export type Classification = {
  verdict: Verdict;
  /** Probabilidad de la clase elegida: p si DEFECTIVE, 1 − p si OK. */
  confidence: number;
  defectProbability: number;
  thresholdApplied: number;
};

/** Convierte la probabilidad de defecto del modelo en un veredicto. */
export function classify(defectProbability: number, threshold: number): Classification {
  if (!Number.isFinite(defectProbability) || defectProbability < 0 || defectProbability > 1) {
    throw new RangeError(`Probabilidad fuera de rango: ${defectProbability}`);
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    throw new RangeError(`Umbral fuera de rango: ${threshold}`);
  }
  const verdict: Verdict = defectProbability >= threshold ? "DEFECTIVE" : "OK";
  return {
    verdict,
    confidence: verdict === "DEFECTIVE" ? defectProbability : 1 - defectProbability,
    defectProbability,
    thresholdApplied: threshold,
  };
}
