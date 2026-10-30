import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const bugsDirectory = new URL("../bugs/", import.meta.url);
const reports = readdirSync(bugsDirectory).filter((name) => /^bug-\d{3}-.+\.md$/.test(name));
const statuses = new Map();
for (const report of reports) {
  const text = readFileSync(new URL(report, bugsDirectory), "utf8");
  const id = `BUG-${report.slice(4, 7)}`;
  let status = "Open";
  if (/^\*\*Partially fixed\b/m.test(text)) status = "Partial";
  else if (/^\*\*Fixed for fresh\/unapplied databases\b/m.test(text)) status = "Fixed (fresh DB)";
  else if (/^\*\*Fixed for local boot\b/m.test(text)) status = "Fixed (local boot)";
  else if (/^\*\*Fixed\b/m.test(text)) status = "Fixed";
  statuses.set(id, status);
}
const registryPath = new URL("Readme.md", bugsDirectory);
const original = readFileSync(registryPath, "utf8");
const newline = original.includes("\r\n") ? "\r\n" : "\n";
let table = null;
const lines = original.split(/\r?\n/).map((line) => {
  if (!line.startsWith("|")) { table = null; return line; }
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  if (cells.includes("Verification") && cells[0] === "ID") {
    const verificationIndex = cells.indexOf("Verification");
    const statusIndex = cells.indexOf("Status");
    table = { index: statusIndex >= 0 ? statusIndex : verificationIndex + 1, existing: statusIndex >= 0 };
    if (!table.existing) cells.splice(table.index, 0, "Status");
  } else if (table && cells.every((cell) => /^:?-+:?$/.test(cell))) {
    if (!table.existing) cells.splice(table.index, 0, "---");
  } else if (table) {
    const id = cells[0].match(/BUG-\d{3}/)?.[0];
    if (!id || !statuses.has(id)) throw new Error(`Unknown registry row: ${cells[0]}`);
    if (table.existing) cells[table.index] = statuses.get(id);
    else cells.splice(table.index, 0, statuses.get(id));
  } else return line;
  return `| ${cells.join(" | ")} |`;
});
const counts = {};
for (const status of statuses.values()) counts[status] = (counts[status] ?? 0) + 1;
const summary = [
  "<!-- implementation-status:start -->",
  "## Current fix status",
  "",
  "Status tracks remediation; Verification records the historical audit proof. Qualified fixes retain the deployment limits in their reports. Partial findings remain open for their stated outstanding work.",
  "",
  "| Status | Count |",
  "|---|---|",
  ...["Fixed", "Fixed (fresh DB)", "Fixed (local boot)", "Partial", "Open"].map((status) => `| ${status} | ${counts[status] ?? 0} |`),
  "",
  "<!-- implementation-status:end -->",
].join(newline);
let updated = lines.join(newline);
if (/<!-- implementation-status:start -->[\s\S]*?<!-- implementation-status:end -->/.test(updated)) {
  updated = updated.replace(/<!-- implementation-status:start -->[\s\S]*?<!-- implementation-status:end -->/, summary);
} else {
  updated = updated.replace("## Master Bug Index", `${summary}${newline}${newline}## Master Bug Index`);
}
writeFileSync(registryPath, updated);
console.log(`Updated ${statuses.size} canonical bug statuses: ${JSON.stringify(counts)}`);
