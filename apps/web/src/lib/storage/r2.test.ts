import { describe, expect, it, vi } from "vitest";
import {
  buildImageKey,
  createImageReadUrl,
  createImageUpload,
  getR2Config,
  imageExists,
  isImageKeyOfCompany,
  isStorageConfigured,
  StorageNotConfiguredError,
  UPLOAD_URL_TTL_SECONDS,
} from "./r2";

const COMPANY = "0190a6a1-1111-7000-8000-000000000001";
const OTHER = "0190a6a1-2222-7000-8000-000000000002";

const config = {
  endpoint: "https://cuenta.r2.cloudflarestorage.com",
  bucket: "rikuy-imagenes",
  accessKeyId: "id",
  secretAccessKey: "secreto",
};

describe("claves de imagen", () => {
  it("sigue el formato del ADR 0005", () => {
    const key = buildImageKey(COMPANY, new Date("2026-03-05T10:00:00Z"), "0190a6a1-3333-7000-8000-000000000003");
    expect(key).toBe(`companies/${COMPANY}/inspections/2026/03/0190a6a1-3333-7000-8000-000000000003.jpg`);
  });

  it("una clave generada pertenece solo a su empresa", () => {
    const key = buildImageKey(COMPANY);
    expect(isImageKeyOfCompany(key, COMPANY)).toBe(true);
    expect(isImageKeyOfCompany(key, OTHER)).toBe(false);
  });

  it.each([
    `companies/${COMPANY}/inspections/2026/13/0190a6a1-3333-7000-8000-000000000003.jpg`,
    `companies/${COMPANY}/inspections/2026/03/../../${OTHER}/x.jpg`,
    `companies/${COMPANY}/inspections/2026/03/0190a6a1-3333-7000-8000-000000000003.png`,
    `/companies/${COMPANY}/inspections/2026/03/0190a6a1-3333-7000-8000-000000000003.jpg`,
    "cualquier-cosa.jpg",
  ])("rechaza claves mal formadas o manipuladas: %s", (key) => {
    expect(isImageKeyOfCompany(key, COMPANY)).toBe(false);
  });

  it("rechaza un companyId que no es UUID", () => {
    expect(() => buildImageKey("../otra")).toThrow();
  });
});

describe("configuración", () => {
  it("indica qué variables faltan", () => {
    expect(() => getR2Config({ R2_ENDPOINT_URL: "https://x" })).toThrow(StorageNotConfiguredError);
    expect(() => getR2Config({})).toThrow(/R2_IMAGES_BUCKET/);
    expect(isStorageConfigured({})).toBe(false);
  });

  it("lee las cuatro variables y quita la barra final del endpoint", () => {
    const env = {
      R2_ENDPOINT_URL: "https://cuenta.r2.cloudflarestorage.com/",
      R2_IMAGES_BUCKET: "b",
      R2_ACCESS_KEY_ID: "a",
      R2_SECRET_ACCESS_KEY: "s",
    };
    expect(getR2Config(env).endpoint).toBe("https://cuenta.r2.cloudflarestorage.com");
    expect(isStorageConfigured(env)).toBe(true);
  });
});

describe("URLs prefirmadas", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  it("la subida es un PUT al bucket privado, con caducidad corta", () => {
    const upload = createImageUpload(COMPANY, config, now);
    const url = new URL(upload.uploadUrl);
    expect(url.origin + url.pathname).toBe(`${config.endpoint}/${config.bucket}/${upload.key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(UPLOAD_URL_TTL_SECONDS));
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(upload.expiresAt.getTime() - now.getTime()).toBe(UPLOAD_URL_TTL_SECONDS * 1000);
    expect(isImageKeyOfCompany(upload.key, COMPANY)).toBe(true);
  });

  it("la URL de lectura no sirve para subir (firma distinta)", () => {
    const upload = createImageUpload(COMPANY, config, now);
    const read = createImageReadUrl(upload.key, config, now);
    expect(read.split("?")[0]).toBe(upload.uploadUrl.split("?")[0]);
    expect(new URL(read).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(upload.uploadUrl).searchParams.get("X-Amz-Signature"),
    );
  });

  it("no contiene el secreto", () => {
    const upload = createImageUpload(COMPANY, config, now);
    expect(upload.uploadUrl).not.toContain(config.secretAccessKey);
  });
});

describe("imageExists", () => {
  const key = buildImageKey(COMPANY);

  it("hace un HEAD firmado y responde true si el objeto existe", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(imageExists(key, config, fetchImpl)).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("HEAD");
    expect(url).toContain(key);
    expect(url).toContain("X-Amz-Signature=");
  });

  it("responde false con 404", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(imageExists(key, config, fetchImpl)).resolves.toBe(false);
  });

  it("lanza con otros errores, para no registrar sin certeza", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(imageExists(key, config, fetchImpl)).rejects.toThrow(/403/);
  });
});
