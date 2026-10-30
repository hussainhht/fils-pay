import type { Pool } from "pg";
import { formatBhd, toFils } from "@filspay/money";
import type { TransactionRow } from "./serialize.js";

export interface TransactionsExportFilters {
  merchantId: string;
  from?: Date;
  to?: Date;
  status?: string[];
}

/** Spreadsheet formula triggers. A leading apostrophe forces a literal cell. */
const FORMULA_PREFIX = new Set(["=", "+", "-", "@", "\t"]);

function neutralizeFormulaPrefix(value: string): string {
  if (value.length > 0 && FORMULA_PREFIX.has(value[0]!)) {
    return `'${value}`;
  }
  return value;
}

function csvEscape(value: string): string {
  const literal = neutralizeFormulaPrefix(value);
  if (literal.includes(",") || literal.includes('"') || literal.includes("\n") || literal.includes("\r")) {
    return `"${literal.replace(/"/g, '""')}"`;
  }
  return literal;
}

function toCsvRow(row: TransactionRow): string {
  return [
    row.id,
    row.status,
    formatBhd(toFils(Number(row.amount_fils))),
    formatBhd(toFils(Number(row.captured_fils))),
    csvEscape(row.reference ?? ""),
    row.occurred_at.toISOString(),
  ].join(",");
}

/** Builds the CSV body for `GET /v1/transactions/export`. */
export async function buildTransactionsExportCsv(
  pool: Pool,
  filters: TransactionsExportFilters,
): Promise<string> {
  const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;
  const result = await pool.query<TransactionRow>(
    `SELECT * FROM transactions
      WHERE merchant_id = $1
        AND ($2::timestamptz IS NULL OR occurred_at >= $2)
        AND ($3::timestamptz IS NULL OR occurred_at <  $3)
        AND ($4::text[] IS NULL OR status = ANY($4))
      ORDER BY occurred_at ASC`,
    [filters.merchantId, filters.from ?? null, filters.to ?? null, statusArray],
  );

  const header = "id,status,amount_bhd,captured_bhd,reference,occurred_at";
  const lines = result.rows.map(toCsvRow);
  return [header, ...lines].join("\n");
}


/**
 * Cursor-paginated export for large date ranges.
 * Pages on `(occurred_at, id)` using Postgres's own timestamp text so rows
 * that share a timestamp, including sub-millisecond ties, are not dropped.
 */
export async function streamTransactionsExportCsv(
  pool: Pool,
  filters: TransactionsExportFilters,
  write: (chunk: string) => void,
  pageSize = 1000,
): Promise<void> {
  write("id,status,amount_bhd,captured_bhd,reference,occurred_at\n");

  let cursorOccurredAt: string | null = null;
  let cursorId: string | null = null;
  const limit = Math.max(1, pageSize);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const statusArray = filters.status && filters.status.length > 0 ? filters.status : null;
    type ExportRow = TransactionRow & { occurred_at_text: string };
    const result: { rows: ExportRow[] } = await pool.query<ExportRow>(
      `SELECT *, occurred_at::text AS occurred_at_text FROM transactions
        WHERE merchant_id = $1
          AND ($2::timestamptz IS NULL OR occurred_at >= $2)
          AND ($3::timestamptz IS NULL OR occurred_at <  $3)
          AND ($4::text[] IS NULL OR status = ANY($4))
          AND ($5::text IS NULL OR (occurred_at, id) > ($5::timestamptz, $6::uuid))
        ORDER BY occurred_at ASC, id ASC
        LIMIT $7`,
      [
        filters.merchantId,
        filters.from ?? null,
        filters.to ?? null,
        statusArray,
        cursorOccurredAt,
        cursorId,
        limit,
      ],
    );

    for (const row of result.rows) {
      write(toCsvRow(row) + "\n");
    }

    if (result.rows.length < limit) break;
    const last: ExportRow = result.rows[result.rows.length - 1]!;
    cursorOccurredAt = last.occurred_at_text;
    cursorId = last.id;
  }
}