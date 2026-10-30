import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInboundWebhookPayload } from "./envelope.js";

test("an inbound webhook body must be a JSON object", () => {
  assert.deepEqual(parseInboundWebhookPayload('{"event":"captured","amountFils":4750}'), {
    event: "captured",
    amountFils: 4750,
  });
  assert.throws(() => parseInboundWebhookPayload("[]"));
  assert.throws(() => parseInboundWebhookPayload("null"));
  assert.throws(() => parseInboundWebhookPayload("4750"));
  assert.throws(() => parseInboundWebhookPayload("not json"));
});
