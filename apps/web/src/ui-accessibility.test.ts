import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// Check actual JSX ancestry: a table must retain its native semantics inside
// a named, keyboard-focusable region so keyboard users can scroll it on mobile.
for (const app of ["web", "admin"]) {
  const pages = join(root, "apps", app, "src/pages");
  for (const file of readdirSync(pages, { recursive: true }).filter((f) => String(f).endsWith(".tsx"))) {
    const filename = join(pages, String(file));
    const source = readFileSync(filename, "utf8");
    if (!source.includes("<table")) continue;
    test(`${app}/${file}: data tables have keyboard-accessible scroll regions`, () => {
      const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node): void {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "table") {
          const parent = node.parent;
          assert.ok(ts.isJsxElement(parent), `${relative(root, filename)}: table needs a scroll container`);
          const attributes = parent.openingElement.attributes.properties;
          const value = (name: string) => attributes.find((a) => ts.isJsxAttribute(a) && a.name.getText(ast) === name);
          assert.match(value("role")?.getText(ast) ?? "", /"region"/);
          assert.match(value("aria-label")?.getText(ast) ?? "", /="[^"]+"/);
          assert.match(value("tabIndex")?.getText(ast) ?? "", /=\{0\}/);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    });
  }
}
