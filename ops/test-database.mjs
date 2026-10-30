import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Integration suites can reset counters and rebuild reporting tables. Never
// infer a target from a developer's default connection settings.
export function assertTestDatabase(env = process.env) {
  const refuse = () => { throw new Error("test database: use an explicit isolated local filspay_test[_suffix] DATABASE_URL, outside production, without connection overrides"); };
  if (env.NODE_ENV === "production" || !env.DATABASE_URL) refuse();
  for (const key of ["PGCONN_SETTLEMENT", "SETTLEMENT_DATABASE_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) {
    if (env[key]) refuse();
  }
  let target;
  try { target = new URL(env.DATABASE_URL); } catch { refuse(); }
  if (!["postgres:", "postgresql:"].includes(target.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !/^\/filspay_test(?:_[a-zA-Z0-9_-]+)?$/.test(target.pathname) || target.hash) refuse();
  // pg/libpq accept destination overrides in URL query parameters. Permit
  // only SSL mode, which does not change the selected host/database.
  for (const [key, value] of target.searchParams) {
    if (key !== "sslmode" || !["disable", "prefer", "require", "verify-ca", "verify-full", "no-verify"].includes(value)) refuse();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertTestDatabase(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
