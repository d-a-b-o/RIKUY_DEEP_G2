import { createOTP } from "@better-auth/utils/otp";

/** Código TOTP actual para un secreto en claro (el mismo que guarda Better Auth). */
export function totpCode(secret: string): Promise<string> {
  return createOTP(secret).totp();
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodifica la clave Base32 que muestra la pantalla de activación. */
export function decodeBase32(value: string): Uint8Array {
  const clean = value.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`Carácter Base32 no válido: ${char}`);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** Código TOTP a partir de la clave Base32 mostrada en pantalla. */
export function totpFromBase32(key: string): Promise<string> {
  return createOTP(decodeBase32(key)).totp();
}
