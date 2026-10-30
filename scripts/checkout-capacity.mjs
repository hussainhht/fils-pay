import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Client-side measurements only. The operator must independently verify the
// simulator, disposable data, source identity and container resource limits.
export function validateManifest(input) {
  const url = new URL(input.baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || input.isolatedSimulator !== true) {
    throw new Error('Requires an explicitly isolated simulator at http://127.0.0.1:PORT');
  }
  for (const key of ['durationSeconds', 'timeoutMs', 'maxInFlight']) {
    if (!Number.isSafeInteger(input[key]) || input[key] <= 0) throw new Error(`Invalid ${key}`);
  }
  if (!['closed', 'arrival'].includes(input.mode)) throw new Error('Invalid mode');
  const load = input.mode === 'closed' ? input.users : input.rate;
  if (!Number.isSafeInteger(load) || load <= 0) throw new Error('Invalid users/rate');
  if (input.mode === 'closed' && input.users > input.maxInFlight) throw new Error('users exceeds maxInFlight');
  if (!Array.isArray(input.tokens) || !input.tokens.length ||
      input.tokens.some(t => typeof t !== 'string' || !/^plink_[A-Za-z0-9_-]+$/.test(t)) ||
      new Set(input.tokens).size !== input.tokens.length) throw new Error('Requires unique pre-created link tokens');
  return { ...input, baseUrl: url.origin };
}

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export async function runBenchmark(input) {
  const config = validateManifest(input);
  // No redirects: a loopback proxy must never redirect a payment to a public service.
  for (const path of ['/healthz', '/readyz']) {
    const response = await fetch(config.baseUrl + path, { redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) });
    const body = await response.json();
    if (response.status !== 200 || body.status !== (path === '/healthz' ? 'ok' : 'ready')) {
      throw new Error('Health/readiness preflight failed');
    }
  }
  const runId = randomUUID();
  const counts = { offered: 0, started: 0, completed: 0, paid: 0, simulatorDecline: 0,
    simulatorError: 0, serverRejected: 0, unexpected: 0, timeout: 0,
    networkError: 0, generatorDropped: 0, fixtureExhausted: 0 };
  const latencies = [];
  const serviceLatencies = [];
  const dispatchDelays = [];
  const statuses = {};
  let nextToken = 0;
  let peakInFlight = 0;
  const pending = new Set();
  const start = performance.now();
  const end = start + config.durationSeconds * 1000;

  async function checkout(token, scheduledAt) {
    const startedAt = performance.now();
    dispatchDelays.push(startedAt - scheduledAt);
    counts.started++;
    const signal = AbortSignal.timeout(config.timeoutMs);
    const request = async (path, options = {}) => {
      const response = await fetch(config.baseUrl + path, { ...options, redirect: 'error', signal });
      const body = await response.json();
      return { response, body };
    };
    try {
      const path = '/v1/payment-links/' + encodeURIComponent(token);
      const link = await request(path);
      let result = link;
      if (link.response.status === 200 && link.body.status === 'active' && link.body.amountFils === 1000 && link.body.currency === 'BHD') {
        result = await request(path + '/pay', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${runId}:${nextToken}:${token}` },
          body: JSON.stringify({ card: { pan: '4111111111114242', expiryMonth: 12, expiryYear: 2030, cvv: '123' } }),
        });
      } else if (link.response.status === 200) {
        counts.unexpected++;
        return;
      }
      const { response, body } = result;
      counts.completed++;
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      if (response.status === 200 && body.status === 'paid' && body.amountFils === 1000 && typeof body.transactionId === 'string') counts.paid++;
      else if (response.status === 402 && ['card_declined', 'card_captured_declined'].includes(body.error)) counts.simulatorDecline++;
      else if (response.status === 502 && body.error === 'acquirer_unavailable') counts.simulatorError++;
      else if ([429, 503].includes(response.status)) counts.serverRejected++;
      else counts.unexpected++;
    } catch (err) {
      if (signal.aborted) counts.timeout++;
      else counts.networkError++;
      // Never print errors containing link URLs, request bodies or tokens.
    } finally {
      latencies.push(performance.now() - scheduledAt);
      serviceLatencies.push(performance.now() - startedAt);
    }
  }

  function launch(scheduledAt) {
    counts.offered++;
    if (pending.size >= config.maxInFlight) { counts.generatorDropped++; return null; }
    const token = config.tokens[nextToken++];
    if (!token) { counts.fixtureExhausted++; return null; }
    const promise = checkout(token, scheduledAt);
    pending.add(promise);
    peakInFlight = Math.max(peakInFlight, pending.size);
    void promise.finally(() => pending.delete(promise));
    return promise;
  }

  if (config.mode === 'closed') {
    await Promise.all(Array.from({ length: config.users }, async () => {
      while (performance.now() < end) {
        const promise = launch(performance.now());
        if (!promise) break;
        await promise;
      }
    }));
  } else {
    // Fixed offered arrivals independent of response completion. Lateness is
    // included in e2e latency; generator drops invalidate a capacity assessment.
    for (let i = 0; i < config.durationSeconds * config.rate; i++) {
      const scheduledAt = start + i * 1000 / config.rate;
      await sleep(Math.max(0, scheduledAt - performance.now()));
      launch(scheduledAt);
    }
  }
  await Promise.all(pending);
  const wallSeconds = (performance.now() - start) / 1000;
  const valid = counts.generatorDropped === 0 && counts.fixtureExhausted === 0;
  return {
    runId, mode: config.mode, durationSeconds: config.durationSeconds, wallSeconds,
    users: config.mode === 'closed' ? config.users : null,
    offeredRate: counts.offered / config.durationSeconds,
    startedRate: counts.started / config.durationSeconds,
    // Includes drain time, so boundary completions cannot inflate goodput.
    completedRate: counts.completed / wallSeconds, paidGoodput: counts.paid / wallSeconds,
    serverAdmittedRate: null, // Cannot be inferred reliably at the HTTP client.
    retries: 0, peakInFlight, counts, statuses,
    e2eMs: percentiles(latencies), serviceMs: percentiles(serviceLatencies), dispatchDelayMs: percentiles(dispatchDelays),
    validClientRun: valid,
    historicalThresholdMet: valid && counts.started > 0 && percentiles(latencies).p95 <= 1500 &&
      (counts.unexpected + counts.timeout + counts.networkError + counts.serverRejected) / counts.started <= 0.01,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(JSON.stringify(await runBenchmark(manifest), null, 2));
  } catch {
    console.error('Benchmark failed; check the private manifest and isolated simulator. No capacity result.');
    process.exitCode = 1;
  }
}
