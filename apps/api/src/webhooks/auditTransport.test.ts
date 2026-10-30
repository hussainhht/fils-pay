import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createFetchTransport } from "./transport.js";
import { backoffDelayMs } from "./dispatcher.js";

test("backoff never exceeds configured cap including positive jitter", () => {
  assert.equal(backoffDelayMs(10, { webhookBackoffBaseMs: 1000, webhookBackoffCapMs: 2000 }, () => 1), 2000);
});

test("development transport rejects a public name resolving to loopback", async () => {
  const transport = createFetchTransport({ nodeEnv: "development" }, async () => [{ address: "127.0.0.1", family: 4 }]);
  const response = await transport({ url: "https://receiver.example.test/", body: "{}", headers: {}, timeoutMs: 1000 });
  assert.equal(response.statusCode, null);
  assert.match(response.errorMessage!, /non-public/);
});

test("real receiver timeout bounds both slow headers and slow response bodies", async () => {
  const server = createServer((req, res) => { if (req.url === "/body") { res.writeHead(200); res.write("waiting"); } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const transport = createFetchTransport({ nodeEnv: "test" });
    for (const path of ["/headers", "/body"]) {
      const start = Date.now();
      const response = await transport({ url: `http://127.0.0.1:${address.port}${path}`, body: "{}", headers: {}, timeoutMs: 100 });
      assert.equal(response.statusCode, null);
      assert.ok(Date.now() - start < 3000);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
