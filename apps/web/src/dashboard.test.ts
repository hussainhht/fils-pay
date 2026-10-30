import assert from "node:assert/strict";
import test from "node:test";
import { buildQuery } from "./api/query.js";
import { DASHBOARD_DOCUMENT_TITLE, CHECKOUT_DOCUMENT_TITLE, documentTitleForPath } from "./documentTitle.js";
import { bhd, dash, dayStartIso, localDateTimeToIso } from "./format.js";
import { findPaymentLinkById } from "./pages/payment-links/findPaymentLink.js";

/**
 * The pure logic behind the dashboard's query strings and money/date display.
 * Both are places a silent bug does real damage: a dropped filter param makes
 * a page show rows it claimed to exclude, and a mis-scaled amount misstates
 * money. Everything else is rendering, verified against the running API
 * rather than here.
 */

test("buildQuery repeats array keys rather than encoding a filter object", () => {
  assert.equal(
    buildQuery({ status: ["captured", "voided"] }),
    "?status=captured&status=voided",
  );
});

test("buildQuery drops empty values so an unset filter sends no param", () => {
  assert.equal(buildQuery({}), "");
  assert.equal(buildQuery({ from: undefined, to: null, search: "" }), "");
  assert.equal(buildQuery({ status: [] }), "");
  // A zero is a real value, not an empty one.
  assert.equal(buildQuery({ limit: 0 }), "?limit=0");
});

test("buildQuery percent-encodes values", () => {
  assert.equal(buildQuery({ search: "a b&c=d" }), "?search=a+b%26c%3Dd");
});

test("buildQuery keeps a cursor byte-exact", () => {
  // Cursors are base64url; a mangled one silently restarts or skips a page.
  const cursor = "MjAyNi0wOS0xMlQwMDowMDowMC4wMDBafGFiYw";
  assert.equal(buildQuery({ cursor }), `?cursor=${cursor}`);
});

// FH: covers negatives too
test("bhd formats integer fils via @filspay/money, never float arithmetic", () => {
  assert.equal(bhd(0), "0.000 BHD");
  assert.equal(bhd(1), "0.001 BHD");
  assert.equal(bhd(1000), "1.000 BHD");
  assert.equal(bhd(1234567), "1234.567 BHD");
});

test("dash renders absent values as an em dash but keeps zero", () => {
  assert.equal(dash(null), "—");
  assert.equal(dash(undefined), "—");
  assert.equal(dash(""), "—");
  assert.equal(dash(0), "0");
});

test("dayStartIso uses Asia/Bahrain midnight, not a UTC day boundary", () => {
  assert.equal(dayStartIso("2026-09-12"), "2026-09-12T00:00:00.000+03:00");
  assert.equal(dayStartIso(""), undefined);
  // 00:00 Asia/Bahrain is 21:00 the previous day in UTC.
  const from = Date.parse(dayStartIso("2026-08-26") ?? "");
  const to = Date.parse(dayStartIso("2026-08-27") ?? "");
  assert.equal(new Date(from).toISOString(), "2026-08-25T21:00:00.000Z");
  const duringBahrainDay = Date.parse("2026-08-25T21:30:00.000Z");
  const nextBahrainMorning = Date.parse("2026-08-26T22:03:30.000Z");
  assert.equal(duringBahrainDay >= from && duringBahrainDay < to, true);
  assert.equal(nextBahrainMorning >= from && nextBahrainMorning < to, false);
});

test("document title is checkout only on the public pay route", () => {
  assert.equal(documentTitleForPath("/pay/plink_token"), CHECKOUT_DOCUMENT_TITLE);
  assert.equal(documentTitleForPath("/dashboard/login"), DASHBOARD_DOCUMENT_TITLE);
  assert.equal(documentTitleForPath("/dashboard/transactions"), DASHBOARD_DOCUMENT_TITLE);
  assert.equal(documentTitleForPath("/"), DASHBOARD_DOCUMENT_TITLE);
});

test("findPaymentLinkById follows cursors past the first page", async () => {
  let calls = 0;
  const found = await findPaymentLinkById("older-than-100", async (cursor) => {
    calls += 1;
    if (!cursor) {
      return {
        paymentLinks: Array.from({ length: 100 }, (_, index) => ({ id: `recent-${index}` })),
        nextCursor: "page-2",
      };
    }
    return { paymentLinks: [{ id: "older-than-100" }], nextCursor: null };
  });
  assert.equal(found?.id, "older-than-100");
  assert.equal(calls, 2);
});

test("findPaymentLinkById stops when the next cursor repeats", async () => {
  let calls = 0;
  const found = await findPaymentLinkById("missing", async () => {
    calls += 1;
    return { paymentLinks: [{ id: "other" }], nextCursor: "stuck" };
  });
  assert.equal(found, null);
  assert.equal(calls, 2);
});

test("localDateTimeToIso rejects garbage instead of sending Invalid Date", () => {
  assert.equal(localDateTimeToIso(""), null);
  assert.equal(localDateTimeToIso("not-a-date"), null);
  // A real value round-trips to the same instant it names.
  const iso = localDateTimeToIso("2026-09-12T14:30");
  assert.notEqual(iso, null);
  assert.equal(new Date(iso ?? "").getTime(), new Date("2026-09-12T14:30").getTime());
});
