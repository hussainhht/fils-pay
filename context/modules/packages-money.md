# Module: `packages/money` (Protected Monetary Math)

> **Status:** **STRICTLY PROTECTED & FROZEN**. No modifications are permitted without explicit, verified human project authorization.

---

## 1. Purpose & Responsibilities

`packages/money` is the single source of truth for all Bahraini Dinar (BHD) arithmetic in TypeScript across the FilsPay repository. It provides:
1. The branded `Fils` integer type preventing raw float assignment.
2. Round-half-to-even ("banker's rounding") integer division using `bigint` arithmetic.
3. Safe monetary arithmetic: addition, subtraction, negation, and comparison.
4. Exact basis point fee calculations (`applyRateFils`).
5. Share allocation algorithms guaranteeing zero drift (`allocateRemainder`).
6. Strict BHD text parsing (`parseBhdToFils`) and formatting (`formatBhd`).

---

## 2. Core Abstractions & API Reference (`src/fils.ts`)

### 1. Branded Type & Constructor
```typescript
export type Fils = number & { readonly __brand: "Fils" };

export function toFils(n: number, opts?: { allowNegative?: boolean }): Fils;
export function isFils(n: unknown): n is Fils;
export const ZERO_FILS: Fils;
```
- `toFils` enforces that `n` is a safe, finite integer. Throws `RangeError` on floats, non-integers, or negative values (unless `{ allowNegative: true }` is specified).

### 2. Banker's Rounding Division
```typescript
export function bankersRoundDiv(numerator: bigint, denominator: bigint): number;
```
- Performs integer division rounding to the nearest integer.
- Breaks exact `.5` ties to the **nearest even number** (half-to-even).
- Uses `bigint` arithmetic throughout; no floating-point numbers ever enter calculation.

### 3. Rate & Fee Calculation
```typescript
export function applyRateFils(amount: Fils, rateBps: number): Fils;
```
- Applies a rate in basis points (100 bps = 1.00% = 0.01).
- Formula: `bankersRoundDiv(BigInt(amount) * BigInt(rateBps), 10_000n)`.
- Guarantees one rounding step using banker's rounding.

### 4. Share Allocation Without Drift
```typescript
export function allocateRemainder(total: Fils, ratios: number[]): Fils[];
```
- Distributes `total` fils among multiple shares according to given proportions.
- Guarantees:
  $$\sum \text{allocated shares} = \text{total}$$
- Allocates remaining fils one by one to shares with the largest fractional remainders, preventing lost or fabricated fils.

### 5. Formatting & Parsing
```typescript
export function formatBhd(fils: Fils): string;
export function parseBhdToFils(text: string): Fils;
```
- `formatBhd`: Formats fils to 3 decimal places (e.g. `4750 fils` $\rightarrow$ `"4.750"`).
- `parseBhdToFils`: Strictly parses a BHD text string. Rejects more than 3 decimals, negative numbers, or invalid characters. Converts `"4.750"` or `"4.75"` to `4750 fils`.

---

## 3. Strict Prohibitions

1. **NEVER use `number` floats for money:** `Math.round(x * 100) / 100`, `toFixed(2)`, and `parseFloat` assume 2-decimal currencies and silently corrupt the 3rd decimal in BHD.
2. **NEVER bypass `toFils`:** Do not cast raw numbers with `as Fils` without validation.
3. **NEVER edit this package:** This package is frozen.

---

## 4. Existing Tests & Verification

- Test suites:
  - `src/fils.test.ts`: 40 tests covering integer boundaries, half-to-even rounding, parsing, and formatting.
  - `src/allocate_drift_known.test.ts`: Allocation sum integrity.
  - `src/parse_cents_compat.test.ts`: Compatibility tests.
  - `src/rounding_legacy.test.ts`: Half-to-even edge cases.
- Command to run:
  ```bash
  npm.cmd run test -w @filspay/money
  ```
  *(100% pure unit tests, runs without PostgreSQL).*
