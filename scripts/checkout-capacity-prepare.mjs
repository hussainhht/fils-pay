import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

// Additive fixtures only, on the dedicated Compose database. No seed, cleanup,
// truncation, schema changes or connection to a host-published database.
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== 'capacity-postgres' || url.pathname !== '/filspay_test_capacity') {
  throw new Error('Fixture preparation requires the isolated capacity Compose database');
}
const [label = 'trial', mode = 'closed', load = '8', seconds = '180', count = '20000'] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]+$/.test(label) || !['closed', 'arrival'].includes(mode) ||
    [load, seconds, count].some(v => !/^\d+$/.test(v) || Number(v) < 1) || Number(count) > 200000) {
  throw new Error('Usage: label closed|arrival users|rate seconds tokenCount (max 200000)');
}
const pool = new Pool({ connectionString: url.href, max: 1 });
const runId = randomUUID();
try {
  const client = await pool.connect();
  let tokens;
  try {
    await client.query('BEGIN');
    const merchantId = (await client.query(
      `INSERT INTO merchants (display_name, mdr_bps, onboarding_status)
       VALUES ($1, 250, 'approved') RETURNING id`, [`Capacity ${runId}`],
    )).rows[0].id;
    tokens = (await client.query(
      `INSERT INTO payment_links (merchant_id, token, amount_fils, reference, expires_at, created_by_type, created_by_id)
       SELECT $1, 'plink_' || $2 || '_' || n, 1000, $2 || '_' || n,
              now() + interval '24 hours', 'merchant_session', $3
         FROM generate_series(1, $4::integer) AS n RETURNING token`,
      [merchantId, runId, randomUUID(), Number(count)],
    )).rows.map(row => row.token);
    await client.query('COMMIT');
    await writeFile(`/capacity-output/${label}.json`, JSON.stringify({
      baseUrl: 'http://127.0.0.1:3300', isolatedSimulator: true,
      mode, users: Number(load), rate: Number(load), durationSeconds: Number(seconds),
      timeoutMs: 15000, maxInFlight: 1024, tokens,
    }), { flag: 'wx', mode: 0o600 });
    // The merchant identifier is fixture metadata, not an authentication token.
    console.log(JSON.stringify({ label, runId, merchantId, tokenCount: tokens.length }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
} finally { await pool.end(); }
