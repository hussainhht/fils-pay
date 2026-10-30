import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { runBenchmark, validateManifest } from './checkout-capacity.mjs';

const fixture = {
  baseUrl: 'http://127.0.0.1:1', isolatedSimulator: true, mode: 'arrival',
  durationSeconds: 1, timeoutMs: 500, maxInFlight: 5, rate: 5,
  tokens: Array.from({ length: 20 }, (_, i) => `plink_test${i}`),
};

test('runner refuses public targets, URL credentials and reused fixtures before HTTP', () => {
  for (const baseUrl of ['https://example.com', 'http://localhost:3000', 'http://user:password@127.0.0.1:3000', 'http://127.0.0.1:3000/public']) {
    assert.throws(() => validateManifest({ ...fixture, baseUrl }));
  }
  assert.throws(() => validateManifest({ ...fixture, isolatedSimulator: false }));
  assert.throws(() => validateManifest({ ...fixture, tokens: ['plink_same', 'plink_same'] }));
});

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('real HTTP GET/pay pairs separate simulator errors, overload and unexpected failures', async () => {
  const seenTokens = new Set();
  const keys = new Set();
  let pays = 0;
  await withServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/readyz') return respond(res, 200, { status: req.url === '/healthz' ? 'ok' : 'ready' });
    if (req.method === 'GET') {
      assert.equal(seenTokens.has(req.url), false);
      seenTokens.add(req.url);
      return respond(res, 200, { status: 'active', amountFils: 1000, currency: 'BHD' });
    }
    assert.ok(seenTokens.has(req.url.replace(/\/pay$/, '')));
    assert.equal(keys.has(req.headers['idempotency-key']), false);
    keys.add(req.headers['idempotency-key']);
    req.resume();
    const results = [[200, { status: 'paid', transactionId: 'test-id', amountFils: 1000 }],
      [402, { error: 'card_declined' }], [502, { error: 'acquirer_unavailable' }],
      [503, { error: 'service_unavailable' }], [502, { error: 'unrelated_proxy_error' }]];
    const [status, body] = results[pays++];
    respond(res, status, body);
  }, async baseUrl => {
    const result = await runBenchmark({ ...fixture, baseUrl });
    assert.equal(result.counts.started, 5);
    assert.equal(result.counts.completed, 5);
    for (const key of ['paid', 'simulatorDecline', 'simulatorError', 'serverRejected', 'unexpected']) assert.equal(result.counts[key], 1);
    assert.equal(result.validClientRun, true);
    assert.equal(result.historicalThresholdMet, false);
    assert.equal(result.serverAdmittedRate, null);
    assert.equal(JSON.stringify(result).includes('plink_'), false);
  });
});

test('arrival generator reports dropped arrivals instead of silently becoming closed loop', async () => {
  await withServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/readyz') return respond(res, 200, { status: req.url === '/healthz' ? 'ok' : 'ready' });
    if (req.method === 'GET') return respond(res, 200, { status: 'active', amountFils: 1000, currency: 'BHD' });
    req.resume();
    setTimeout(() => respond(res, 200, { status: 'paid', transactionId: 'test', amountFils: 1000 }), 350);
  }, async baseUrl => {
    const result = await runBenchmark({ ...fixture, baseUrl, rate: 10, maxInFlight: 1, timeoutMs: 1000 });
    assert.equal(result.counts.offered, 10);
    assert.ok(result.counts.generatorDropped > 0);
    assert.equal(result.peakInFlight, 1);
    assert.equal(result.validClientRun, false);
    assert.equal(result.historicalThresholdMet, false);
  });
});

test('closed loop reports fixture exhaustion as invalid instead of a capacity success', async () => {
  await withServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/readyz') return respond(res, 200, { status: req.url === '/healthz' ? 'ok' : 'ready' });
    if (req.method === 'GET') return respond(res, 200, { status: 'active', amountFils: 1000, currency: 'BHD' });
    req.resume();
    respond(res, 200, { status: 'paid', transactionId: 'test', amountFils: 1000 });
  }, async baseUrl => {
    const result = await runBenchmark({ ...fixture, baseUrl, mode: 'closed', users: 2, tokens: fixture.tokens.slice(0, 2) });
    assert.equal(result.counts.paid, 2);
    assert.ok(result.counts.fixtureExhausted > 0);
    assert.equal(result.validClientRun, false);
  });
});
