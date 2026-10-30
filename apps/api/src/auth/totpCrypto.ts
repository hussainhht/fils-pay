import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

export type AuthPlane = "merchant" | "admin";

/** Bind ciphertext to its identity/plane so copying rows cannot transfer a factor. */
export function encryptTotpSecret(secret: string, keyB64: string, plane: AuthPlane, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  cipher.setAAD(Buffer.from(`filspay:totp:v1:${plane}:${userId}`));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptTotpSecret(ciphertext: string, keyB64: string, plane: AuthPlane, userId: string): string {
  const [version, iv, tag, data, extra] = ciphertext.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra) throw new Error("Invalid authenticator ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(`filspay:totp:v1:${plane}:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export async function createTotpSetup(plane: AuthPlane, label: string) {
  const secret = generateSecret();
  const provision = new URL(generateURI({ issuer: `FilsPay ${plane}`, label, secret, algorithm: "sha1", digits: 6, period: 30 }));
  provision.searchParams.set("algorithm", "SHA1");
  provision.searchParams.set("digits", "6");
  provision.searchParams.set("period", "30");
  const uri = provision.toString();
  return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 4, width: 256 }) };
}

/** Six digits, SHA-1, 30 seconds, at most one past/future step. Replay is checked under DB row lock. */
export async function acceptedTotpStep(secret: string, token: string, lastStep: number | null, epoch = Math.floor(Date.now() / 1000)): Promise<number | null> {
  if (!/^\d{6}$/.test(token)) return null;
  try {
    const result = await verify({ strategy: "totp", secret, token, epoch, algorithm: "sha1", digits: 6, period: 30,
      epochTolerance: 30, ...(lastStep === null ? {} : { afterTimeStep: lastStep }) });
    return result.valid && "timeStep" in result && Math.abs(result.timeStep - Math.floor(epoch / 30)) <= 1 ? result.timeStep : null;
  } catch {
    return null;
  }
}

export function recoveryDigest(code: string, plane: AuthPlane, userId: string): string {
  return createHash("sha256").update(`filspay:recovery:${plane}:${userId}:${code.replace(/-/g, "").toLowerCase()}`).digest("hex");
}

export function createRecoveryCodes(plane: AuthPlane, userId: string) {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"));
  return { codes, hashes: codes.map((code) => recoveryDigest(code, plane, userId)) };
}

export function recoveryIndex(code: string, hashes: readonly string[], plane: AuthPlane, userId: string): number {
  if (!/^[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3}$/.test(code)) return -1;
  const expected = Buffer.from(recoveryDigest(code, plane, userId), "hex");
  let found = -1;
  hashes.forEach((hash, index) => {
    const actual = Buffer.from(hash, "hex");
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) found = index;
  });
  return found;
}
