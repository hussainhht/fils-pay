import assert from "node:assert/strict";
import { test } from "node:test";
import { generateInviteCode } from "./inviteCode.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

test("invite codes use the unambiguous alphabet", () => {
  for (let i = 0; i < 30; i++) {
    const code = generateInviteCode();
    assert.equal(code.length, 8);
    for (const char of code) {
      assert.equal(ALPHABET.includes(char), true);
    }
  }
});

test("invite codes are not drawn from Math.random", () => {
  const original = Math.random;
  Math.random = () => 0;
  try {
    assert.notEqual(generateInviteCode(8), "AAAAAAAA");
  } finally {
    Math.random = original;
  }
});
