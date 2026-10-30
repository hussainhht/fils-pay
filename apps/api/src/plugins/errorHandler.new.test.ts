import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestError } from "../lib/errors.js";
import { errorHandler } from "./errorHandler.js";

function capture() {
  const sent: Array<{ status: number; body: unknown }> = [];
  const logged: unknown[] = [];
  const reply = {
    code(status: number) {
      return {
        send(body: unknown) {
          sent.push({ status, body });
        },
      };
    },
  };
  const request = {
    log: {
      error(...args: unknown[]) {
        logged.push(args);
      },
    },
  };
  return { sent, logged, reply, request };
}

test("AppError responses stay the published status and code", () => {
  const { sent, reply, request } = capture();
  errorHandler(new BadRequestError("invalid_request", "amount is required"), request as never, reply as never);
  assert.deepEqual(sent, [{ status: 400, body: { error: "invalid_request", message: "amount is required" } }]);
});

test("unexpected errors are a generic 500 and do not return SQL or a stack", () => {
  const { sent, logged, reply, request } = capture();
  const err = new Error('select password_hash from admin_users where email = $1 — duplicate key violates unique constraint "admin_users_email_key"');
  err.stack = "Error: secret\n    at query (/srv/db/pool.ts:12:4)";
  errorHandler(err, request as never, reply as never);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.status, 500);
  assert.deepEqual(sent[0]!.body, { error: "internal_error" });
  const body = JSON.stringify(sent[0]!.body);
  assert.equal(body.includes("password_hash"), false);
  assert.equal(body.includes("admin_users"), false);
  assert.equal(body.includes("pool.ts"), false);
  assert.equal(logged.length, 1);
});

test("a money-parsing RangeError stays a server error and is still logged", () => {
  const { sent, logged, reply, request } = capture();
  const err = new RangeError("toFils: expected an integer number of fils, got 1.5");
  errorHandler(err, request as never, reply as never);
  assert.equal(sent[0]!.status, 500);
  assert.deepEqual(sent[0]!.body, { error: "internal_error" });
  assert.equal(JSON.stringify(sent[0]!.body).includes("toFils"), false);
  assert.equal(logged.length, 1);
  const fields = logged[0] as [Record<string, unknown>, string];
  assert.equal(fields[0]?.err, err);
});
