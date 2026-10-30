/**
 * Unit tests for the transactions CSV export body builder, against a real,
 * migrated Postgres (run `npm run migrate` first).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { buildTransactionsExportCsv, streamTransactionsExportCsv } from "./exportCsv.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "exportCsv.test.ts requires DATABASE_URL to point at a real, migrated Postgres",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

after(async () => {
  await pool.end();
});

async function createMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Export CSV Test ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

async function insertTransaction(
  merchantId: string,
  opts: { status: string; amountFils: number; capturedFils: number; reference: string | null; occurredAt: string },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, reference, acquirer_reference, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      merchantId,
      opts.status,
      opts.amountFils,
      opts.capturedFils,
      opts.reference,
      `acq_${randomUUID()}`,
      opts.occurredAt,
    ],
  );
  return result.rows[0]!.id;
}

test("builds a header plus one line per matching transaction", async () => {
  const merchantId = await createMerchant();
  const firstId = await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 12500,
    capturedFils: 12500,
    reference: "order-1",
    occurredAt: "2026-04-01T10:00:00Z",
  });
  await insertTransaction(merchantId, {
    status: "authorized",
    amountFils: 4000,
    capturedFils: 0,
    reference: null,
    occurredAt: "2026-04-02T10:00:00Z",
  });

  const csv = await buildTransactionsExportCsv(pool, { merchantId });
  const lines = csv.split("\n");

  assert.equal(lines[0], "id,status,amount_bhd,captured_bhd,reference,occurred_at");
  assert.equal(lines.length, 3);

  // Rows come back in ascending occurred_at order, so the first data line is
  // the earlier transaction.
  assert.deepEqual(lines[1]!.split(","), [
    firstId,
    "captured",
    "12.500",
    "12.500",
    "order-1",
    "2026-04-01T10:00:00.000Z",
  ]);

  // A null reference renders as an empty field, not the string "null".
  assert.equal(lines[2]!.split(",")[4], "");
});

/** Merchant scoping lives in the WHERE clause, not in the route, so a direct caller cannot widen it. */
test("only includes the named merchant's own rows", async () => {
  const merchantId = await createMerchant();
  const otherMerchantId = await createMerchant();
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "mine",
    occurredAt: "2026-04-01T10:00:00Z",
  });
  await insertTransaction(otherMerchantId, {
    status: "captured",
    amountFils: 2000,
    capturedFils: 2000,
    reference: "theirs",
    occurredAt: "2026-04-01T11:00:00Z",
  });

  const csv = await buildTransactionsExportCsv(pool, { merchantId });

  assert.equal(csv.split("\n").length, 2);
  assert.ok(csv.includes("mine"));
  assert.ok(!csv.includes("theirs"));
});

// timestamps here are UTC. a Bahrain-day export needs the caller to pass +03:00 bounds — FH
test("from/to narrow the exported range, upper bound exclusive", async () => {
  const merchantId = await createMerchant();
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "before",
    occurredAt: "2026-04-01T00:00:00Z",
  });
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "inside",
    occurredAt: "2026-04-05T00:00:00Z",
  });
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "on-upper-bound",
    occurredAt: "2026-04-10T00:00:00Z",
  });

  const csv = await buildTransactionsExportCsv(pool, {
    merchantId,
    from: new Date("2026-04-02T00:00:00Z"),
    to: new Date("2026-04-10T00:00:00Z"),
  });

  assert.equal(csv.split("\n").length, 2);
  assert.ok(csv.includes("inside"));
  assert.ok(!csv.includes("before"));
  assert.ok(!csv.includes("on-upper-bound"));
});

test("a status filter narrows to the listed statuses", async () => {
  const merchantId = await createMerchant();
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "cap",
    occurredAt: "2026-04-01T00:00:00Z",
  });
  await insertTransaction(merchantId, {
    status: "voided",
    amountFils: 1000,
    capturedFils: 0,
    reference: "void",
    occurredAt: "2026-04-02T00:00:00Z",
  });

  const captured = await buildTransactionsExportCsv(pool, { merchantId, status: ["captured"] });
  assert.equal(captured.split("\n").length, 2);
  assert.ok(captured.includes("cap"));
  assert.ok(!captured.includes("void"));

  // An empty status array means "no status filter", not "match nothing".
  const all = await buildTransactionsExportCsv(pool, { merchantId, status: [] });
  assert.equal(all.split("\n").length, 3);
});

// no test for a reference starting with "=" — am
test("a reference containing a comma or a quote is CSV-escaped", async () => {
  const merchantId = await createMerchant();
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: 'inv-1,"urgent"',
    occurredAt: "2026-04-01T00:00:00Z",
  });

  const csv = await buildTransactionsExportCsv(pool, { merchantId });
  const dataLine = csv.split("\n")[1]!;

  assert.ok(dataLine.includes('"inv-1,""urgent"""'));
});

test("a formula-prefixed reference is emitted as a literal cell", async () => {
  const merchantId = await createMerchant();
  const references = ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1+1"];
  for (const [index, reference] of references.entries()) {
    await insertTransaction(merchantId, {
      status: "captured",
      amountFils: 1000,
      capturedFils: 1000,
      reference,
      occurredAt: `2026-04-0${index + 1}T00:00:00Z`,
    });
  }

  const csv = await buildTransactionsExportCsv(pool, { merchantId });
  const lines = csv.split("\n").slice(1);
  assert.deepEqual(
    lines.map((line) => line.split(",")[4]),
    references.map((reference) => `'${reference}`),
  );
});

test("streamTransactionsExportCsv keeps rows that share a timestamp, including sub-millisecond ties", async () => {
  const merchantId = await createMerchant();
  const shared = "2026-05-01T10:00:00.000000Z";
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "tie-a",
    occurredAt: shared,
  });
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "tie-a2",
    occurredAt: shared,
  });
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "tie-b",
    occurredAt: shared,
  });
  await insertTransaction(merchantId, {
    status: "captured",
    amountFils: 1000,
    capturedFils: 1000,
    reference: "tie-c",
    occurredAt: shared,
  });
  await pool.query(
    `UPDATE transactions SET occurred_at = '2026-05-01 10:00:00.000001+00' WHERE merchant_id = $1 AND reference = 'tie-b'`,
    [merchantId],
  );
  await pool.query(
    `UPDATE transactions SET occurred_at = '2026-05-01 10:00:00.000002+00' WHERE merchant_id = $1 AND reference = 'tie-c'`,
    [merchantId],
  );

  const full = await buildTransactionsExportCsv(pool, { merchantId });
  assert.equal(full.split("\n").length, 5);

  let streamed = "";
  await streamTransactionsExportCsv(pool, { merchantId }, (chunk) => {
    streamed += chunk;
  }, 1);
  const references = streamed
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[4]);
  assert.deepEqual(references.slice().sort(), ["tie-a", "tie-a2", "tie-b", "tie-c"]);
  assert.ok(references.indexOf("tie-b") < references.indexOf("tie-c"));
});
