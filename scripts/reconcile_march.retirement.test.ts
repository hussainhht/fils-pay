import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = fileURLToPath(new URL("./reconcile_march.ts", import.meta.url));

test("retired entrypoint has no database or financial posting capability", () => {
  const source = ts.createSourceFile(entrypoint, readFileSync(entrypoint, "utf8"), ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration);
  assert.deepEqual(imports.map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text), ["node:url"]);
  assert.doesNotMatch(source.text, /\b(?:Client|Pool|randomUUID|ledger_entries|process\.env)\b|\brequire\s*\(/);
  function inspect(node: ts.Node): void {
    assert.ok(!(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword), "no dynamic imports");
    ts.forEachChild(node, inspect);
  }
  inspect(source);
});

// A regression that reintroduces pg fails at module loading, before a client
// can be constructed or the historical financial logic can run.
const guard = `
  import { registerHooks } from 'node:module';
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'pg' || specifier.startsWith('pg/')) {
      throw new Error('FORBIDDEN_DATABASE_IMPORT');
    }
    return nextResolve(specifier, context);
  }});
`;

function run(args: string[], databaseUrl?: string) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.NODE_OPTIONS;
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--import", `data:text/javascript,${encodeURIComponent(guard)}`, ...args,
  ], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.stderr, /FORBIDDEN_DATABASE_IMPORT/);
  return result;
}

test("direct and repeated execution refuse before any database import with or without configuration", () => {
  for (const databaseUrl of [undefined, "postgres://invalid:invalid@127.0.0.1:1/never_connect"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = run([entrypoint], databaseUrl);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^reconcile_march: retired; financial postings are disabled\./);
      assert.doesNotMatch(result.stderr, /DATABASE_URL|ECONNREFUSED|reconciliation applied/);
    }
  }
});

test("import is silent, does not connect, and preserves historical pure helpers", () => {
  const result = run(["--input-type=module", "--eval", `
    const module = await import('./scripts/reconcile_march.ts');
    const assert = (await import('node:assert/strict')).default;
    assert.equal(module.computeResidueFils(4759), 9);
    assert.equal(module.monthBounds(2026, 3).start.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.equal(process.exitCode, undefined);
    assert.deepEqual(Object.keys(module).sort(), ['computeResidueFils', 'monthBounds']);
  `], "postgres://invalid:invalid@127.0.0.1:1/never_connect");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("package scripts and checked-in automation do not invoke the retired script", () => {
  const manifests = ["package.json"];
  for (const directory of ["apps", "packages"]) {
    for (const child of readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${directory}/${child.name}/package.json`;
      if (child.isDirectory() && existsSync(new URL(`../${path}`, import.meta.url))) manifests.push(path);
    }
  }
  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
    assert.doesNotMatch(JSON.stringify(manifest.scripts ?? {}), /reconcile_march/, path);
  }
  function inspect(directory: URL): void {
    if (!existsSync(directory)) return;
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(child.name + (child.isDirectory() ? "/" : ""), directory);
      if (child.isDirectory()) inspect(path);
      else if (/\.(?:ya?ml|m?js|[cm]?ts|sh|ps1|cmd|bat)$/.test(child.name) || child.name.startsWith("Dockerfile")) {
        assert.doesNotMatch(readFileSync(path, "utf8"), /reconcile_march/, fileURLToPath(path));
      }
    }
  }
  for (const directory of ["ops/", ".github/", ".circleci/"]) inspect(new URL(`../${directory}`, import.meta.url));
  for (const filename of [".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml", "docker-compose.yml"]) {
    const path = new URL(`../${filename}`, import.meta.url);
    if (existsSync(path)) assert.doesNotMatch(readFileSync(path, "utf8"), /reconcile_march/, filename);
  }
});
