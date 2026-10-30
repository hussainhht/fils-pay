#!/usr/bin/env -S npx tsx
/**
 * RETIRED (PMA-08 / BUG-033). Do not use for financial corrections.
 *
 * The original posted captured_fils % 10 over a UTC March window to the
 * wrong accounts, minting fresh entry groups on every run. Database access
 * and posting code have been removed, with no reactivation bypass.
 * Historical implementation: Git c3eb21830dd133a47e86bf5f9150a3ba8f9caffd,
 * scripts/reconcile_march.ts. Only pure helpers remain for existing tests.
 * BUG-034 handles scheme-line residue on new settlement closes separately.
 */
import { pathToFileURL } from "node:url";

/** Historical UTC window; not a policy for new financial reconciliation. */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

/** Pure historical arithmetic; not a reconciliation posting calculation. */
export function computeResidueFils(capturedFils: number): number {
  return capturedFils % 10;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  console.error("reconcile_march: retired; financial postings are disabled. Historical corrections require a separately approved remediation design.");
  process.exitCode = 1;
}
