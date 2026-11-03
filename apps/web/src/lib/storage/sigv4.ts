import { createHash, createHmac } from "node:crypto";

/**
 * Firma de URLs prefirmadas compatible con S3 (AWS Signature Version 4, firma en
 * la query). Cloudflare R2 implementa la API de S3, así que sirve para subir y
 * leer imágenes sin exponer las credenciales al navegador (ADR 0005).
 *
 * Se implementa aquí, sin dependencias, porque solo hace falta firmar URLs; la
 * prueba unitaria la valida contra el ejemplo oficial de la documentación de AWS.
 */

export type SigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD";
  /** URL del objeto sin query, p. ej. https://<cuenta>.r2.cloudflarestorage.com/bucket/clave.jpg */
  url: string;
  credentials: SigV4Credentials;
  /** R2 usa "auto". */
  region: string;
  /** Validez en segundos (máximo 7 días en S3). */
  expiresIn: number;
  now?: Date;
};

const MAX_EXPIRES = 7 * 24 * 60 * 60;

/** Codifica según RFC 3986, como exige SigV4. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Codifica cada segmento de la ruta sin tocar las barras. */
function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
}

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Fecha en formato AWS: 20130524T000000Z. */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Devuelve la URL prefirmada para `method` sobre `url`. */
export function presignUrl({ method, url, credentials, region, expiresIn, now = new Date() }: PresignInput): string {
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES) {
    throw new RangeError(`expiresIn debe estar entre 1 y ${MAX_EXPIRES} segundos`);
  }
  const target = new URL(url);
  if (target.search) throw new Error("La URL a firmar no debe llevar query");

  const timestamp = amzDate(now);
  const day = timestamp.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;

  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", timestamp],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .sort()
    .join("&");

  const canonicalPath = encodePath(target.pathname);
  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    `host:${target.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return `${target.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
