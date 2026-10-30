import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque session token or raw API key, base64url-encoded from `crypto.randomBytes`. */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/** sha256 of a string or Buffer, hex-encoded. */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

const EVEN_HEX = /^(?:[0-9a-fA-F]{2})*$/;

/**
 * Constant-time comparison of two hex-encoded digests.
 * Rejects odd length and non-hex characters before decoding. Node's hex
 * decoder drops a trailing nibble, so "ab" and "abc" would otherwise match.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !EVEN_HEX.test(a) || !EVEN_HEX.test(b)) {
    return false;
  }
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

