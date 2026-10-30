import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWebhookUrl } from "./create.js";

const blocked = [
  "127.0.0.1",
  "10.1.2.3",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "localhost",
  "localhost.",
  "settlement",
  "[::1]",
  "[fe80::1]",
];

test("development registration rejects private, loopback, link-local, metadata, and localhost webhook URLs", () => {
  for (const host of blocked) {
    assert.throws(
      () => validateWebhookUrl(`http://${host}/hook`, { nodeEnv: "development" }),
      { code: "invalid_url" },
      host,
    );
  }
  assert.equal(validateWebhookUrl("https://hooks.example.com/filspay", { nodeEnv: "development" }).hostname, "hooks.example.com");
});

test("the test harness can still register a loopback receiver", () => {
  assert.equal(validateWebhookUrl("http://127.0.0.1:9/hook", { nodeEnv: "test" }).hostname, "127.0.0.1");
});
