/** Operator-only admin creation. Supply one JSON object on stdin, never as arguments. */
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { hashPassword } from "../auth/passwords.js";
import { loadConfig, type Config } from "../config.js";

export type AdminRole = "support" | "finance" | "super_admin";
export interface AdminInput { email: string; displayName: string; role: AdminRole; password: string }

/** Inserts one active admin with an argon2id hash. Fails if the email exists; never updates. */
export async function createAdminUser(pool: Pick<Pool, "query">, config: Config, input: AdminInput): Promise<{ adminUserId: string }> {
  const passwordHash = await hashPassword(input.password, config);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.email, passwordHash, input.displayName, input.role],
  );
  return { adminUserId: result.rows[0]!.id };
}

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== "--confirm-admin") throw new Error("confirmation required");
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 16_384) throw new Error("input too large");
  }
  const input = JSON.parse(raw) as Partial<AdminInput>;
  if (typeof input.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(input.email) || input.email.length > 255 ||
      typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.length > 255 ||
      !["support", "finance", "super_admin"].includes(String(input.role)) ||
      typeof input.password !== "string" || input.password.length < 20 || input.password.length > 128) {
    throw new Error("invalid input");
  }
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const result = await createAdminUser(pool, config, input as AdminInput);
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Database and validation errors can contain input; never print them.
    process.stderr.write("Admin provisioning failed. Check input and configuration securely.\n");
    process.exitCode = 1;
  });
}
