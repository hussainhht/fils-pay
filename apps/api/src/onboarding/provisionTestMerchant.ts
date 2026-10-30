/** Operator-only test merchant creation. Supply one JSON object on stdin, never as arguments. */
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { createTestMerchantWithOwner, type SignupInput } from "./signup.js";

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== "--confirm-test-merchant") {
    throw new Error("confirmation required");
  }
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 16_384) throw new Error("input too large");
  }
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== "object") throw new Error("invalid input");
  const signup = input as SignupInput;
  const profile = signup.businessProfile;
  const owner = signup.owner;
  const required = [profile?.legalName, profile?.registrationNumber, profile?.contactEmail,
    profile?.contactPhone, profile?.addressLine1, profile?.city, owner?.email];
  if (!required.every((value) => typeof value === "string" && value.trim().length > 0 && value.length <= 255) ||
      !["sole_proprietorship", "llc", "partnership", "public_company", "other"].includes(profile?.businessType) ||
      typeof owner?.password !== "string" || owner.password.length < 20 || owner.password.length > 128) {
    throw new Error("invalid input");
  }
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const result = await createTestMerchantWithOwner(pool, config, signup);
    process.stdout.write(JSON.stringify({ merchantId: result.merchantId, ownerUserId: result.ownerUserId }) + "\n");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // Database and validation errors can contain input; never print them.
  process.stderr.write("Test merchant provisioning failed. Check input and configuration securely.\n");
  process.exitCode = 1;
});
