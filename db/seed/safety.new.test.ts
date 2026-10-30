import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { generate } from "./generate.js";
import { assertDestructiveSeedAllowed } from "./safety.js";

const optedIn = { ALLOW_DESTRUCTIVE_SEED: "1", NODE_ENV: "test" };

test("destructive seeding requires explicit opt-in even for a local database", () => {
  for (const value of [undefined, "0", "true", ""]) {
    assert.throws(
      () => assertDestructiveSeedAllowed("postgres://localhost/filspay", { ALLOW_DESTRUCTIVE_SEED: value }),
      /ALLOW_DESTRUCTIVE_SEED=1/,
    );
  }
});

test("opt-in cannot authorize production, remote, or unrelated destinations", () => {
  assert.throws(
    () => assertDestructiveSeedAllowed("postgres://localhost/filspay", { ...optedIn, NODE_ENV: "production" }),
    /development\/test/,
  );
  for (const destination of [
    undefined,
    "not-a-url",
    "postgres://db.example.com/filspay",
    "postgres://127.0.0.1/payments_production",
    "postgres://localhost/filspay?host=production.example.com",
    "postgres://localhost/filspay?dbname=production",
    "https://localhost/filspay",
  ]) {
    assert.throws(() => assertDestructiveSeedAllowed(destination, optedIn), /seed:/);
  }
});

test("explicit opt-in allows supported disposable local/dev destinations", () => {
  for (const destination of [
    "postgres://localhost:5432/filspay",
    "postgresql://127.0.0.1:5433/filspay_test_wave1?sslmode=disable",
    "postgres://[::1]/filspay_dev",
    "postgres://postgres/filspay",
  ]) {
    assert.doesNotThrow(() => assertDestructiveSeedAllowed(destination, optedIn));
  }
});

test("direct generator invocation refuses before acquiring a connection", async () => {
  const previous = process.env.ALLOW_DESTRUCTIVE_SEED;
  delete process.env.ALLOW_DESTRUCTIVE_SEED;
  let connections = 0;
  const pool = {
    options: { connectionString: "postgres://localhost/filspay_test" },
    connect: async () => { connections += 1; throw new Error("must not connect"); },
  } as unknown as Pool;
  try {
    await assert.rejects(generate(pool), /ALLOW_DESTRUCTIVE_SEED=1/);
    assert.equal(connections, 0);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DESTRUCTIVE_SEED;
    else process.env.ALLOW_DESTRUCTIVE_SEED = previous;
  }
});
