import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const password = randomBytes(32).toString('hex');
const root = new URL('./', import.meta.url);
await mkdir(new URL('runtime/', root), { recursive: true });
// Exclusive creation: an existing database's password must never be rotated.
await writeFile(new URL('.env', root), [
  `POSTGRES_PASSWORD=${password}`,
  `DATABASE_URL=postgres://capacity:${password}@capacity-postgres:5432/filspay_test_capacity`,
  `SETTLEMENT_INTERNAL_TOKEN=${randomBytes(32).toString('hex')}`,
  `WEBHOOK_SECRET_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
  `ACQUIRER_CALLBACK_SIGNING_SECRET=${randomBytes(32).toString('hex')}`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log('Created private capacity configuration. Existing files are never replaced.');
