import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const tsx = fileURLToPath(import.meta.resolve("tsx/cli"));
const env = { ...process.env };
delete env.DATABASE_URL;
delete env.PGCONN_SETTLEMENT;
delete env.SETTLEMENT_DATABASE_URL;

// Explicitly audited database-free suites. Database and live-browser suites
// remain available through their separate, opt-in commands.
const suites = [
  ["packages/money/", [tsx, "--test", "src/*.test.ts"]],
  ["packages/events/", [tsx, "--test", "src/*.test.ts"]],
  ["apps/web/", [tsx, "--test", "src/**/*.test.ts"]],
  ["", ["--test", "ops/test-database.test.mjs"]],
  ["", [tsx, "--test", "scripts/expire_holds.test.ts", "scripts/expire_holds.new.test.ts",
    "scripts/lib/sqlFilter.new.test.ts", "scripts/reconcile_march.test.ts",
    "scripts/reconcile_march.retirement.test.ts", "scripts/reconcile_march.safety.test.ts",
    "db/seed/safety.new.test.ts"]],
];

for (const [directory, args] of suites) {
  const result = spawnSync(process.execPath, args, {
    cwd: fileURLToPath(new URL(directory, root)), env, stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error("Unit test process could not start.");
    process.exitCode = result.status || 1;
    break;
  }
}
