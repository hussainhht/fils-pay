// Public RFC 6238 example key. Never use this key for a real account.
export const demoSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

export async function demoTotp(time = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("12345678901234567890"),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(time / 30_000)));
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1]! & 15;
  const value = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

export async function verifyDemoCode(code: string, time = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const codes = await Promise.all([-30_000, 0, 30_000].map((drift) => demoTotp(time + drift)));
  return codes.includes(code);
}
