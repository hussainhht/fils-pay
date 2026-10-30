import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededRng } from "./rng.js";

test("the same acquirer seed replays the same sequence", () => {
  const first = createSeededRng(42);
  const second = createSeededRng(42);
  const fromFirst = [first.next(), first.next(), first.int(0, 10), first.int(4, 4)];
  const fromSecond = [second.next(), second.next(), second.int(0, 10), second.int(4, 4)];
  assert.deepEqual(fromFirst, fromSecond);
});

test("seeded int stays inside the inclusive bounds", () => {
  const rng = createSeededRng(7);
  for (let i = 0; i < 200; i++) {
    const n = rng.int(3, 9);
    assert.equal(Number.isInteger(n), true);
    assert.ok(n >= 3 && n <= 9);
  }
  assert.equal(createSeededRng(1).int(4, 4), 4);
});
