// Opt-in browser checks using an installed Chromium browser, with no npm additions.
// UI cases intercept payment requests with explicit sandbox fixtures. --live also
// verifies a payment using the local API/Postgres and newly inserted test fixtures.
// Run: node --import tsx apps/web/scripts/checkout.browser.test.mjs [--live] [--baseline]
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = "http://127.0.0.1:5173";
const browserPath = process.argv.find((arg) => arg.startsWith("--browser="))?.slice(10)
  ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const baseline = process.argv.includes("--baseline");
const profile = await mkdtemp(join(tmpdir(), "filspay-checkout-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
let baselineFile;
let pool;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Browser did not expose its debugging endpoint")), 15000);
    browser.once("error", reject);
    browser.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback?.reject(Error(message.error.message)); else callback?.resolve(message.result);
    } else listeners.get(message.method)?.(message.params);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  const js = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ": " + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await js(expression)) return; await new Promise((resolve) => setTimeout(resolve, 30)); }
    throw Error(`Timed out: ${expression}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  const browserErrors = [];
  listeners.set("Runtime.exceptionThrown", () => browserErrors.push("Uncaught browser exception"));
  let fixture = {};
  let live = false;
  let requests = [];
  let authCalls = 0;
  let response = { status: 200, body: { status: "paid", transactionId: "sandbox-transaction", amountFils: 4750, paidAt: new Date().toISOString() } };
  let holdPayment = false;
  let held = [];
  const fulfill = (requestId, result) => send("Fetch.fulfillRequest", { requestId, responseCode: result.status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result.body)).toString("base64") });
  if (baseline) {
    const source = execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/").replace(/\/$/, "")}`, "show", "HEAD:apps/web/src/pages/checkout/CheckoutPage.tsx"], { cwd: root, encoding: "utf8", windowsHide: true });
    const candidate = join(root, "apps/web/src/pages/checkout/CheckoutBaselineVerification.tsx");
    await writeFile(candidate, source, { flag: "wx" });
    baselineFile = candidate;
  }
  listeners.set("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      if (baseline && url.pathname.endsWith("/CheckoutPage.tsx")) {
        const module = await (await fetch(`${base}/src/pages/checkout/CheckoutBaselineVerification.tsx`)).text();
        await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/javascript" }], body: Buffer.from(module).toString("base64") });
      } else if (url.pathname.includes("/v1/auth/")) {
        authCalls++; await send("Fetch.continueRequest", { requestId });
      } else if (!live && url.pathname.includes("/v1/payment-links/")) {
        if (request.method === "POST") {
          requests.push(request);
          if (holdPayment) held.push(requestId);
          else if (response.failure) await send("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" });
          else await fulfill(requestId, response);
        } else await fulfill(requestId, { status: 200, body: fixture });
      } else await send("Fetch.continueRequest", { requestId });
    } catch { browserErrors.push("Browser interception failed"); }
  });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*v1/*" }, ...(baseline ? [{ urlPattern: "*CheckoutPage.tsx*" }] : [])] });
  const navigate = async (overrides = {}) => {
    fixture = { token: "sandbox-fixture", status: "active", amountFils: 4750, currency: "BHD", merchantDisplayName: "Sandbox Merchant", description: "Order payment", reference: "TEST-1042", expiresAt: new Date(Date.now() + 3600000).toISOString(), ...overrides };
    requests = [];
    await send("Page.navigate", { url: `${base}/pay/sandbox-fixture?case=${Date.now()}` });
    await waitFor('document.querySelector(".checkout-page") && !document.body.textContent.includes("Preparing your checkout")');
  };
  const fill = async (selector, value) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).select()`);
    await send("Input.insertText", { text: value });
  };
  const fillCard = async (number = "4242424242424242", expiry = "12/30", cvv = "123") => {
    await fill("#card-number", number); await fill("#card-expiry", expiry); await fill("#card-cvv", cvv);
  };
  const submit = () => js('document.querySelector("form").dispatchEvent(new Event("submit", {bubbles:true,cancelable:true}))');
  const pass = (name) => console.log(`PASS ${name}`);

  if (baseline && process.argv.includes("--retry-only")) {
    await navigate();
    await fill("form input:first-of-type", "4242424242424242");
    await fill("form label:last-child input", "123");
    response = { status: 502, body: { error: "acquirer_error" } };
    await submit(); await waitFor('document.querySelector(".checkout-error") !== null');
    const originalKey = Object.entries(requests[0].headers).find(([name]) => name.toLowerCase() === "idempotency-key")[1];
    await submit(); await waitFor('document.querySelector("button").disabled === false');
    assert.equal(requests.length, 2);
    const retryKey = Object.entries(requests[1].headers).find(([name]) => name.toLowerCase() === "idempotency-key")[1];
    // Compare without exposing either request identifier in assertion output.
    assert.equal(retryKey === originalKey, true, "An uncertain payment must retain its idempotency key");
  }

  // This same behavior check runs against baseline code without altering it.
  await navigate({ expiresAt: new Date(Date.now() + 1200).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await js('document.querySelector("form") === null && document.body.textContent.includes("Link expired")'), true, "An open expired link must remove its payment form");
  pass("open payment link expires without a refresh");
  if (baseline) process.exitCode = 0;
  else {
    await navigate();
    assert.equal(await js('document.querySelectorAll(".checkout-card-logos img").length'), 3);
    assert.equal(await js('document.querySelector("input[type=checkbox]") === null'), true);
    assert.equal(await js('document.querySelector(".checkout-save-note").textContent.includes("unavailable")'), true);
    pass("empty field brand logos and honest unavailable card saving");
    assert.match(await js('getComputedStyle(document.documentElement).fontFamily'), /Inter/);
    assert.equal(await js('[...document.querySelectorAll("input")].every(e => e.labels.length === 1 && e.inputMode === "numeric" && e.autocomplete.startsWith("cc-"))'), true);
    assert.equal(await js('document.querySelector("#card-cvv").type'), "password");
    pass("font tokens, accessible labels, numeric keyboards, autofill and masked security code");
    await js('document.querySelector("#card-number").focus()');
    for (const next of ["card-expiry", "card-cvv"]) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      assert.equal(await js('document.activeElement.id'), next);
    }
    pass("keyboard tab order follows card number, expiration and security code");
    await navigate(); // Capture the untouched checkout, before blur validation.
    for (const [width, height, name] of [[1280, 900, "desktop"], [390, 844, "mobile"], [320, 760, "small-mobile"]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true, `${name} horizontal overflow`);
      assert.equal(await js('[...document.querySelectorAll("input,button")].every(e => e.getBoundingClientRect().height >= 44)'), true);
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(join(root, `Evidence/implementation/checkout-${name}.png`), Buffer.from(shot.data, "base64"));
    }
    pass("desktop, 390px and 320px layouts and touch targets; screenshots saved");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await fill("#card-number", "4242-4242 4242 4242");
    assert.equal(await js('document.querySelector("#card-number").value'), "4242 4242 4242 4242");
    await js('document.querySelector("#card-number").setSelectionRange(5,5)');
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    assert.equal(await js('document.querySelector("#card-number").selectionStart'), 3);
    assert.equal(await js('document.querySelector("#card-number").value'), "4244 2424 2424 242");
    pass("native paste/input formatting and separator deletion preserve caret");
    await fill("#card-number", "2221000000000009");
    assert.equal(await js('document.querySelector("#card-brand").textContent'), "Mastercard");
    await fill("#card-number", "6011111111111117");
    assert.equal(await js('document.querySelector(".checkout-card-logos svg") !== null'), true);
    pass("Mastercard 2-series and generic unknown-brand indicators update immediately");
    await fill("#card-number", "4242424242424242");
    await js(`const input=document.querySelector('#card-number');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'42424242 4242 4242');
      input.setSelectionRange(4,4); input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentForward'}));`);
    assert.equal(await js('document.querySelector("#card-number").value'), "4242 2424 2424 242");
    pass("mobile input-only separator deletion removes a digit");
    await fillCard("378282246310005", "12/2030", "123");
    assert.equal(await js('document.querySelector("#card-number").value'), "3782 822463 10005");
    await submit();
    assert.equal(requests.length, 0);
    assert.equal(await js('document.activeElement.id'), "card-cvv");
    assert.equal(await js('document.querySelector("#card-cvv-error").textContent.includes("4-digit")'), true);
    pass("Amex formatting and invalid CVV prevent submission and focus the error");
    await fillCard("4242424242424242", "12/20", "123");
    await submit();
    assert.equal(requests.length, 0);
    assert.equal(await js('document.activeElement.id'), "card-expiry");
    pass("expired card is blocked before a payment request");
    await fillCard();
    holdPayment = true;
    await js('const f=document.querySelector("form"); f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));');
    await waitFor('document.querySelector("button[type=submit]").disabled');
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].postData).card.pan, "4242424242424242");
    assert.deepEqual(Object.keys(JSON.parse(requests[0].postData)), ["card"]);
    await fulfill(held.shift(), response); holdPayment = false;
    await waitFor('document.body.textContent.includes("Payment successful")');
    assert.equal(await js('document.querySelector("input") === null'), true);
    pass("double submission sends one normalized request; success removes sensitive fields");

    for (const status of [502, 409, 500, "network"]) {
      await navigate(); await fillCard();
      response = status === "network" ? { failure: true } : { status, body: { error: status === 409 ? "payment_link_processing" : "acquirer_error" } };
      await submit(); await waitFor('document.querySelector(".checkout-error") !== null');
      const key = Object.entries(requests[0].headers).find(([name]) => name.toLowerCase() === "idempotency-key")[1];
      const body = requests[0].postData;
      assert.equal(await js('[...document.querySelectorAll("input")].every(e=>e.readOnly)'), true);
      response = { status: 200, body: { status: "paid", transactionId: "sandbox-retry", amountFils: 4750, paidAt: new Date().toISOString() } };
      await submit(); await waitFor('document.body.textContent.includes("Payment successful")');
      assert.equal(requests.length, 2);
      assert.equal(Object.entries(requests[1].headers).find(([name]) => name.toLowerCase() === "idempotency-key")[1], key);
      assert.equal(requests[1].postData, body);
    }
    pass("uncertain 502/409/500/network outcomes retry identical payloads under the same idempotency key");
    await navigate(); await fillCard("4000000000000002");
    response = { status: 402, body: { error: "card_declined", stage: "authorize" } };
    await submit(); await waitFor('document.querySelector(".checkout-error") !== null');
    const declinedKey = Object.entries(requests[0].headers).find(([name]) => name.toLowerCase() === "idempotency-key")[1];
    assert.equal(await js('document.querySelector("#card-number").readOnly'), false);
    await fillCard();
    response = { status: 200, body: { status: "paid", transactionId: "sandbox-after-decline", amountFils: 4750, paidAt: new Date().toISOString() } };
    await submit(); await waitFor('document.body.textContent.includes("Payment successful")');
    assert.notEqual(Object.entries(requests[1].headers).find(([name]) => name.toLowerCase() === "idempotency-key")[1], declinedKey);
    pass("definitive decline permits a new card and a fresh idempotency key");
    for (const status of ["paid", "expired", "canceled", "processing"]) {
      await navigate({ status }); assert.equal(await js('document.querySelector("form") === null'), true);
    }
    pass("paid, expired, canceled and processing links cannot start a payment");
    assert.equal(authCalls, 0);
    assert.deepEqual(browserErrors, []);
    pass("public checkout makes no customer/merchant auth calls and has no browser exceptions");

    if (process.argv.includes("--live")) {
      const { default: pg } = await import("pg");
      const { randomUUID } = await import("node:crypto");
      const { createPaymentLink } = await import("../../api/src/paymentLinks/create.ts");
      const compose = await readFile(join(root, "ops/docker-compose.yml"), "utf8");
      const url = new URL(compose.match(/DATABASE_URL:\s*(postgres:\/\/[^\s]+)/)[1]);
      url.hostname = "127.0.0.1"; url.port = "5432";
      pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 2000 });
      const merchant = (await pool.query("INSERT INTO merchants (display_name, mdr_bps, onboarding_status) VALUES ($1,250,'approved') RETURNING id", [`Sandbox checkout verification ${randomUUID()}`])).rows[0];
      const link = await createPaymentLink(pool, { checkoutBaseUrl: base }, { merchantId: merchant.id, amountFils: 4750, reference: "CHECKOUT-UI-TEST", description: "Sandbox verification", expiresAt: new Date(Date.now()+3600000).toISOString(), createdByType: "merchant_session", createdById: randomUUID() });
      live = true;
      await send("Page.navigate", { url: `${base}/pay/${encodeURIComponent(link.token)}` });
      await waitFor('document.querySelector("#card-number") !== null');
      await fillCard(); await submit();
      await waitFor('document.body.textContent.includes("Payment successful")');
      const state = (await pool.query("SELECT pl.status, t.status AS transaction_status, t.captured_fils FROM payment_links pl JOIN transactions t ON t.id=pl.transaction_id WHERE pl.id=$1", [link.id])).rows[0];
      assert.equal(state.status, "paid"); assert.equal(state.transaction_status, "captured"); assert.equal(Number(state.captured_fils), 4750);
      const ledger = (await pool.query("SELECT SUM(CASE WHEN direction='debit' THEN amount_fils ELSE -amount_fils END)::text AS balance FROM ledger_entries WHERE transaction_id=(SELECT transaction_id FROM payment_links WHERE id=$1)", [link.id])).rows[0];
      assert.equal(ledger.balance, "0");
      pass("LIVE browser → Vite proxy → API → simulator → Postgres: captured and balanced ledger");
    }
  }
} finally {
  await pool?.end();
  if (baselineFile) await unlink(baselineFile);
  socket?.close();
  browser.kill();
  // Browser may briefly retain its generated OS-temporary profile after exit.
}
