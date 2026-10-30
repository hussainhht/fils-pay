import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("./reconcile_march.ts", import.meta.url));
// Deny pg resolution before evaluation, even against the unfixed script.
// The historical posting logic must never run during a regression test.
const loader = `export async function resolve(specifier, context, next) {
  if (specifier === 'pg' || specifier.startsWith('pg/')) {
    throw new Error('FORBIDDEN_DATABASE_DEPENDENCY');
  }
  return next(specifier, context);
}`;
const preload = `import { register } from 'node:module';
register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)}, import.meta.url);`;

function run(args: string[], configured: boolean) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  if (configured) env.DATABASE_URL = "postgres://invalid:invalid@127.0.0.1:1/never_connect";
  return spawnSync(process.execPath, [
    "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    "--import", "tsx", ...args,
  ], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
}

test("retired March entrypoint contains no database dependency or posting implementation", () => {
  const source = readFileSync(script, "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["node:url"]);
  assert.doesNotMatch(source, /\b(?:Client|Pool|randomUUID|INSERT|UPDATE|DELETE|DATABASE_URL|postResidueCorrection)\b/);
});

test("direct and repeated execution refuse before loading pg, with or without configuration", () => {
  for (const [configured, args] of [[false, []], [true, []], [true, ["--dry-run"]]] as const) {
    const result = run([script, ...args], configured);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /reconcile_march: retired.*financial postings are disabled/i);
    assert.doesNotMatch(result.stderr, /FORBIDDEN_DATABASE_DEPENDENCY/);
    assert.equal(result.stdout, "");
  }
});

test("import is silent, loads no pg, and exposes only historical pure helpers", () => {
  const result = run(["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    const module = await import('./scripts/reconcile_march.ts');
    assert.deepEqual(Object.keys(module).sort(), ['computeResidueFils', 'monthBounds']);
    assert.equal(process.exitCode, undefined);
    assert.equal(module.computeResidueFils(4759), 9);
    assert.equal(module.monthBounds(2026, 3).start.toISOString(), '2026-03-01T00:00:00.000Z');
  `], true);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("package scripts and checked-in automation do not invoke the retired script", () => {
  const packageFiles = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    for (const dir of readdirSync(`${root}/${parent}`, { withFileTypes: true })) {
      if (dir.isDirectory()) {
        const candidate = `${parent}/${dir.name}/package.json`;
        try { readFileSync(`${root}/${candidate}`); packageFiles.push(candidate); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
  }
  for (const path of packageFiles) {
    const pkg = JSON.parse(readFileSync(`${root}/${path}`, "utf8")) as { scripts?: Record<string, string> };
    for (const command of Object.values(pkg.scripts ?? {})) assert.doesNotMatch(command, /reconcile_march/);
  }
  function checkAutomation(dir: string): void {
    let entries;
    try { entries = readdirSync(`${root}/${dir}`, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) checkAutomation(path);
      else if (/\.(?:ya?ml|[cm]?js|sh|ps1|json)$/.test(entry.name)) {
        assert.doesNotMatch(readFileSync(`${root}/${path}`, "utf8"), /reconcile_march/);
      }
    }
  }
  checkAutomation(".github");
  checkAutomation("ops");
});
