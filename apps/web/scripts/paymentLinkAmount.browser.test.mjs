// Installed Chromium; mocked UI cases use the Vite preview on :5173.
// --live additionally starts isolated API/Vite servers against DATABASE_URL,
// which must name a local filspay_expiration_test_* migrated database.
// Run --live with node --import tsx. --baseline loads the HEAD creation page.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let base = "http://127.0.0.1:5173";
const baseline = process.argv.includes("--baseline");
const browserPath = process.argv.find((arg) => arg.startsWith("--browser="))?.slice(10)
  ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "filspay-amount-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
const baselineFiles = [];
let liveApp;
let liveVite;
let livePool;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Browser debugging endpoint unavailable")), 15000);
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
      const callback = pending.get(message.id); pending.delete(message.id);
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
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await js(expression)) return; await new Promise((resolve) => setTimeout(resolve, 30)); }
    throw Error(`Timed out: ${expression}`);
  };
  const errors = [];
  let requests = [];
  let responseStatus = 500;
  let responseError = { error: "sandbox_rejected", message: "Sandbox creation rejected" };
  let role = "owner";
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const link = { id: "sandbox-link", token: "sandbox-token", amountFils: 1500, status: "active", currency: "BHD", reference: "Order 42", description: "Test order", expiresAt, url: `${base}/pay/sandbox-token`, createdAt: new Date().toISOString() };
  const fulfill = (requestId, status, body, contentType = "application/json") => send("Fetch.fulfillRequest", { requestId, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: contentType }], body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64") });
  if (baseline) {
    for (const filename of ["PaymentLinkCreatePage.tsx", "ExpirationInput.tsx", "ExpirationInput.css", "expiration.ts"]) {
      let source = execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/").replace(/\/$/, "")}`, "show", `HEAD:apps/web/src/pages/payment-links/${filename}`], { cwd: root, encoding: "utf8", windowsHide: true });
      source = source.replaceAll('./expiration.js', './expirationBaselineVerification.js')
        .replaceAll('./ExpirationInput.js', './ExpirationInputBaselineVerification.js')
        .replaceAll('./ExpirationInput.css', './ExpirationInputBaselineVerification.css');
      const candidate = join(root, "apps/web/src/pages/payment-links", filename.replace(/\.(tsx?|css)$/, "BaselineVerification.$1"));
      await writeFile(candidate, source, { flag: "wx" }); baselineFiles.push(candidate);
    }
  }
  listeners.set("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const path = new URL(request.url).pathname;
      if (baseline && path.endsWith("/PaymentLinkCreatePage.tsx")) {
        const source = await (await fetch(`${base}/src/pages/payment-links/PaymentLinkCreatePageBaselineVerification.tsx`)).text();
        await fulfill(requestId, 200, source, "text/javascript");
      } else if (path === "/v1/auth/me") {
        await fulfill(requestId, 200, { merchantUserId: "sandbox-user", role, email: "sandbox@example.test", merchant: { id: "sandbox-merchant", displayName: "Sandbox Merchant", onboardingStatus: "approved", refundsEnabled: true } });
      } else if (request.method === "POST") {
        requests.push({ path, body: JSON.parse(request.postData) });
        await fulfill(requestId, responseStatus, responseStatus === 201 ? link : responseError);
      } else {
        await fulfill(requestId, 200, { paymentLinks: [link], nextCursor: null });
      }
    } catch (err) { errors.push(err.message); }
  });
  await send("Page.enable"); await send("Runtime.enable");
  listeners.set("Runtime.exceptionThrown", () => errors.push("Uncaught browser exception"));
  await send("Fetch.enable", { patterns: [{ urlPattern: "*v1/*" }, ...(baseline ? [{ urlPattern: "*PaymentLinkCreatePage.tsx*" }] : [])] });
  const navigate = async () => {
    requests = [];
    await send("Page.navigate", { url: `${base}/dashboard/payment-links/new?case=${Date.now()}` });
    await waitFor('document.querySelector("form input") !== null');
  };
  const input = 'document.querySelector("form input")';
  const fill = async (text) => {
    await js(`${input}.focus(); ${input}.select()`);
    await send("Input.insertText", { text });
  };
  const select = (start, end = start, direction = "none") => js(`${input}.setSelectionRange(${start},${end},${JSON.stringify(direction)}); ${input}.dispatchEvent(new Event('select', {bubbles:true}))`);
  const check = async (value, start, end = start) => {
    assert.equal(await js(`${input}.value`), value);
    if (start !== undefined) assert.deepEqual(await js(`[${input}.selectionStart, ${input}.selectionEnd]`), [start, end]);
  };
  const key = async (key, code, windowsVirtualKeyCode) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };
  const paste = (text) => js(`(() => { const e=${input}; const data=new DataTransfer(); data.setData('text/plain',${JSON.stringify(text)}); const allowed=e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data})); return allowed; })()`);
  const submit = () => js('document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
  let groups = 0;
  const pass = (name) => { groups++; console.log(`PASS ${name}`); };

  await navigate();
  await fill("1"); await check("1");
  await send("Input.insertText", { text: "." }); await check("1.", 2);
  await send("Input.insertText", { text: "5" }); await check("1.5", 3);
  await send("Input.insertText", { text: "00" }); await check("1.500", 5);
  pass("1 -> 1. -> 1.5 -> 1.500 stays exactly as typed with native caret");
  assert.equal(await js(`${input}.type`), "text");
  assert.equal(await js(`${input}.inputMode`), "decimal");
  assert.equal(await js(`${input}.labels[0].textContent.includes('BHD')`), true);

  await fill("12500"); await select(2); await send("Input.insertText", { text: "." }); await check("12.500", 3);
  await key("Backspace", "Backspace", 8); await check("12500", 2);
  await select(1); await key("Delete", "Delete", 46); await check("1500", 1);
  await send("Input.insertText", { text: "." }); await check("1.500", 2);
  pass("insert/delete/reposition decimal without shifting digits or jumping caret");

  await fill("12.500"); await select(0, 6); await send("Input.insertText", { text: "1.250" }); await check("1.250", 5);
  await fill("0.100"); await select(2, 5); await send("Input.insertText", { text: "001" }); await check("0.001", 5);
  await fill("12.500"); await select(1, 2); await send("Input.insertText", { text: "3" }); await check("13.500", 2);
  await select(1, 2); await key("Delete", "Delete", 46); await check("1.500", 1);
  pass("requested examples, selection replacement, middle digit edits and deletion");

  for (const text of [".", "-", "4"]) {
    await fill("1.500"); await select(text === "4" ? 4 : 1);
    await send("Input.insertText", { text }); await check("1.500", text === "4" ? 4 : 1);
  }
  await select(0, 5, "backward");
  assert.equal(await paste("-1.500"), false); await check("1.500", 0, 5);
  assert.equal(await js(`${input}.selectionDirection`), "backward");
  for (const text of ["1.2345", "1.2.3", "1e3", "1,500", " 1.500 "]) {
    assert.equal(await paste(text), false); await check("1.500", 0, 5);
  }
  assert.equal(await paste("12.345"), true);
  await send("Input.insertText", { text: "12.345" }); await check("12.345", 6);
  pass("invalid typing/paste rejected as a whole; valid paste and backward selection preserved");

  // A mobile/autofill input event may be non-cancellable or omit beforeinput data.
  await fill("1.500"); await select(1, 2, "backward");
  await js(`(() => {const e=${input}; e.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:false,inputType:'insertText',data:'.'})); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1..500'); e.setSelectionRange(2,2); e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'.'}));})()`);
  await check("1.500", 1, 2);
  assert.equal(await js(`${input}.selectionDirection`), "backward");
  pass("non-cancellable mobile input fallback restores value, caret and selection direction");

  for (const width of [390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await fill("0."); await send("Input.insertText", { text: "001" }); await check("0.001", 5);
    await select(2, 5); await send("Input.insertText", { text: "100" }); await check("0.100", 5);
    await key("ArrowLeft", "ArrowLeft", 37); await check("0.100", 4);
    await key("Tab", "Tab", 9);
    assert.equal(await js('document.activeElement === document.querySelectorAll("form input")[1]'), true);
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  pass("390px/320px mobile viewports retain decimal editing, arrow keys and tab order without overflow");

  for (const [draft, normalized] of [["0.", "0.000"], ["1.", "1.000"], ["1.5", "1.500"], [".001", "0.001"], ["00012.50", "12.500"], ["", ""], [".", "."]]) {
    await fill(draft); await check(draft); await js(`${input}.blur()`); await check(normalized);
  }
  await fill("1.500"); await select(0, 5); await key("Backspace", "Backspace", 8); await check("", 0);
  pass("intermediate states, blur-only normalization and clearing the field");

  await fill("0"); await submit(); assert.equal(requests.length, 0);
  await fill("9007199254740.992"); await submit(); assert.equal(requests.length, 0);
  await fill("1.5");
  assert.equal(await js('document.querySelectorAll("input[name=expiration]").length'), 6);
  const choose = (value) => js(`document.querySelector('input[name=expiration][value="${value}"]').click()`);
  const setField = (selector, value) => js(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));})()`);
  await choose("custom"); await submit(); assert.equal(requests.length, 0);
  if (process.argv.includes("--check-layout-first")) {
    assert.equal(await js(`(() => {
      const elements=[...document.querySelector('fieldset').children].filter(e=>e.getBoundingClientRect().height);
      return elements.every((e,i)=>!i||e.getBoundingClientRect().top>=elements[i-1].getBoundingClientRect().bottom);
    })()`), true, "expiration controls and helper text must not overlap");
    pass("expiration controls and helper text do not overlap");
  }
  assert.equal(await js('document.querySelector("#payment-link-expiration-date")?.type'), "date", "custom expiration must offer a calendar date picker");
  assert.equal(await js('document.querySelector("#payment-link-expiration-time")?.type'), "time");
  const parts = (timestamp) => {
    const value = new Date(timestamp + 3 * 3600000).toISOString();
    return [value.slice(0, 10), value.slice(11, 16)];
  };
  const setExpiration = async (timestamp) => {
    const [date, time] = parts(timestamp);
    await setField("#payment-link-expiration-date", date);
    await setField("#payment-link-expiration-time", time);
    return new Date(`${date}T${time}:00+03:00`).toISOString();
  };
  for (const timestamp of [Date.now() - 86400000, Date.now() - 60000, Date.now() + 14 * 60000, Date.now() + 121 * 86400000]) {
    await setExpiration(timestamp); await submit(); assert.equal(requests.length, 0);
    assert.equal(await js('document.querySelector("button[type=submit]").disabled'), true);
  }
  await setField("#payment-link-expiration-time", "25:61"); await submit(); assert.equal(requests.length, 0);
  await setField("#payment-link-expiration-date", ""); await submit(); assert.equal(requests.length, 0);
  pass("zero/unsafe amounts and missing/past/invalid/out-of-bounds custom dates and times send no request");

  for (const [option, seconds] of [["15-minutes", 900], ["24-hours", 86400], ["7-days", 604800], ["30-days", 2592000], ["90-days", 7776000]]) {
    await choose(option);
    assert.equal(await js('document.querySelectorAll("input[name=expiration]:checked").length'), 1);
    assert.equal(await js('document.querySelector("#payment-link-expiration-date") === null'), true);
    assert.equal(await js('document.querySelector("[data-expiration-preview]").textContent.includes("Estimated expiration")'), true);
    assert.equal(await js('document.querySelector("fieldset").textContent.includes("Bahrain time (UTC+03:00)")'), true);
    assert.equal(await js('getComputedStyle(document.querySelector("input[name=expiration]:checked").closest("label")).backgroundColor'), "rgb(234, 245, 239)");
    await submit(); await waitFor('document.querySelector(".dash-error")?.textContent === "Sandbox creation rejected"');
    assert.equal(requests.at(-1).body.expiresInSeconds, seconds);
    assert.equal("expiresAt" in requests.at(-1).body, false);
  }
  pass("all five presets select exactly one green radio, show the timezone estimate and send durations without hidden custom values");

  await choose("custom");
  for (const days of [1, 7, 119]) {
    const expected = await setExpiration(Date.now() + days * 86400000);
    await submit(); await waitFor('document.querySelector(".dash-error")?.textContent === "Sandbox creation rejected"');
    assert.equal(requests.at(-1).body.expiresAt, expected);
    assert.equal("expiresInSeconds" in requests.at(-1).body, false);
    assert.equal(await js('document.querySelector("[data-expiration-preview]").textContent.includes("Expires on")'), true);
  }
  const selected = await setExpiration(Date.now() + 86400000);
  const customPreview = await js('document.querySelector("[data-expiration-preview]").textContent');
  await js('window.originalNow=Date.now; Date.now=()=>window.originalNow()+3*3600000');
  await submit(); await waitFor('document.querySelector(".dash-error")?.textContent === "Sandbox creation rejected"');
  assert.equal(requests.at(-1).body.expiresAt, selected);
  assert.equal(await js('document.querySelector("[data-expiration-preview]").textContent'), customPreview);
  await js('Date.now=window.originalNow');
  const boundaryNow = Math.floor(Date.now() / 60000) * 60000;
  await js(`window.originalNow=Date.now; Date.now=()=>${boundaryNow}`);
  for (const seconds of [900, 10368000]) {
    const expected = await setExpiration(boundaryNow + seconds * 1000);
    assert.equal(await js('document.querySelector("form").checkValidity()'), true);
    await submit(); await waitFor('document.querySelector(".dash-error")?.textContent === "Sandbox creation rejected"');
    assert.equal(requests.at(-1).body.expiresAt, expected);
  }
  for (const seconds of [840, 10368060]) {
    const count = requests.length;
    await setExpiration(boundaryNow + seconds * 1000); await submit();
    assert.equal(requests.length, count);
    assert.equal(await js('document.querySelector("form").checkValidity()'), false);
  }
  await js('Date.now=window.originalNow');
  await setExpiration(Date.now() + 86400000);
  responseStatus = 400; responseError = { error: "invalid_expiry", message: "Technical server validation text" };
  await submit(); await waitFor('document.querySelector("#payment-link-expiration-time-error") !== null');
  assert.equal(await js('document.querySelector("#payment-link-expiration-time-error").textContent.includes("15 minutes and 120 days")'), true);
  assert.equal(await js('document.body.textContent.includes("Technical server validation text")'), false);
  responseStatus = 500; responseError = { error: "sandbox_rejected", message: "Sandbox creation rejected" };
  await choose("15-minutes");
  const previewBefore = await js('document.querySelector("[data-expiration-preview]").textContent');
  await js('window.originalNow=Date.now; Date.now=()=>window.originalNow()+3*3600000');
  await submit(); await waitFor('document.querySelector(".dash-error")?.textContent === "Sandbox creation rejected"');
  assert.equal(requests.at(-1).body.expiresInSeconds, 900);
  assert.notEqual(await js('document.querySelector("[data-expiration-preview]").textContent'), previewBefore);
  await js('Date.now=window.originalNow');
  pass("custom timestamps stay exact, both bounds pass, stale/out-of-bounds choices cannot submit, server validation stays inline");

  await js('document.querySelector("input[name=expiration]:checked").focus()');
  await key("ArrowRight", "ArrowRight", 39);
  assert.equal(await js('document.querySelector("input[name=expiration]:checked").value'), "24-hours");
  await key("ArrowLeft", "ArrowLeft", 37);
  assert.equal(await js('document.querySelector("input[name=expiration]:checked").value'), "15-minutes");
  await navigate(); await fill("1.500");
  for (const width of [1440, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await choose("custom");
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await js('document.querySelector("fieldset").querySelector("legend").textContent'), "Link expiration");
    assert.equal(await js('document.querySelector("#payment-link-expiration-date").labels[0].textContent.includes("Expiration date")'), true);
    await setExpiration(Date.now() + 5 * 60000);
    assert.equal(await js(`(() => {
      const section=document.querySelector('fieldset');
      const elements=[...section.children].filter(e=>e.getBoundingClientRect().height);
      const separated=elements.every((e,i)=>!i||e.getBoundingClientRect().top>=elements[i-1].getBoundingClientRect().bottom);
      const error=section.querySelector('.payment-link-expiration-error');
      return separated && error && error.getBoundingClientRect().top>=error.parentElement.querySelector('input').getBoundingClientRect().bottom;
    })()`), true, `expiration text/controls must not overlap at ${width}px`);
    if (process.argv.includes("--screenshots") && [1440, 320].includes(width)) {
      const capture = async (state) => {
        await js('document.activeElement.blur(); new Promise(resolve => setTimeout(resolve, 200))');
        const { contentSize } = await send("Page.getLayoutMetrics");
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height: contentSize.height, scale: 1 } });
        await writeFile(join(root, `Evidence/implementation/link-expiration-${width}-${state}.png`), Buffer.from(shot.data, "base64"));
      };
      await capture("error");
      await setExpiration(Date.now() + 86400000);
      await capture("custom");
    }
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await choose("24-hours");
  pass("native arrow-key radios, labeled date/time controls and inline errors stay separated at desktop/tablet/390px/320px");

  await js(`const fields=document.querySelectorAll('form input'); for(const [n,v] of [[1,' Order 42 '],[2,' Test order ']]) {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(fields[n],v);fields[n].dispatchEvent(new Event('input',{bubbles:true}));}`);
  for (const [draft, fils] of [["1.5", 1500], ["0.100", 100], ["0.001", 1], ["1.", 1000], ["9007199254740.991", Number.MAX_SAFE_INTEGER]]) {
    await fill(draft); await submit(); await waitFor('document.querySelector(".dash-error")?.textContent === "Sandbox creation rejected"');
    assert.equal(requests.at(-1).path, "/v1/merchants/sandbox-merchant/payment-links");
    assert.equal(requests.at(-1).body.amountFils, fils);
    assert.equal(requests.at(-1).body.reference, "Order 42");
    assert.equal(requests.at(-1).body.description, "Test order");
    assert.equal(await js('document.querySelector(".dash-error").textContent'), "Sandbox creation rejected");
  }
  pass("submission normalizes without blur, sends exact safe integer fils, retains metadata and API errors");

  responseStatus = 201; await fill("1.5"); await submit();
  await waitFor('location.pathname === "/dashboard/payment-links/sandbox-link"');
  pass("successful creation navigates to the existing payment-link detail page");

  role = "support";
  await send("Page.navigate", { url: `${base}/dashboard/payment-links/new?role=support` });
  await waitFor('document.querySelector("main") && document.body.textContent.includes("New payment link")');
  assert.equal(await js('document.querySelector("form") === null'), true);
  pass("existing support-role restriction still hides the creation form");

  if (process.argv.includes("--live")) {
    const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
    assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && /^\/filspay_expiration_test_[0-9]+$/.test(database.pathname), "--live requires an isolated local expiration test database");
    const { default: pg } = await import("pg");
    const { randomUUID, randomBytes } = await import("node:crypto");
    const { buildApp } = await import("../../api/src/app.ts");
    const { loadConfig } = await import("../../api/src/config.ts");
    const { hashPassword } = await import("../../api/src/auth/passwords.ts");
    const { markDbConnectedOnce } = await import("../../api/src/health/state.ts");
    const { createServer } = await import("vite");
    livePool = new pg.Pool({ connectionString: database.href });
    const config = loadConfig({ DATABASE_URL: database.href, NODE_ENV: "test", WEBHOOK_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"), ACQUIRER_FAILURE_RATE: "0" });
    liveApp = buildApp(config, livePool);
    liveApp.log.level = "silent"; // Never print development OTPs or test credentials.
    await livePool.query("SELECT 1"); markDbConnectedOnce();
    const api = await liveApp.listen({ port: 0, host: "127.0.0.1" });
    liveVite = await createServer({ root: join(root, "apps/web"), configFile: join(root, "apps/web/vite.config.ts"),
      define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") },
      server: { host: "127.0.0.1", port: 0, proxy: { "/v1": api, "/healthz": api, "/readyz": api } } });
    await liveVite.listen(); base = `http://127.0.0.1:${liveVite.httpServer.address().port}`;
    liveApp.config.checkoutBaseUrl = base;
    for (const path of ["/healthz", "/readyz"]) assert.equal((await fetch(`${base}${path}`)).status, 200);
    assert.equal((await livePool.query("SELECT 1 AS alive")).rows[0].alive, 1);
    const merchant = (await livePool.query("INSERT INTO merchants (display_name, mdr_bps, onboarding_status) VALUES ($1,250,'approved') RETURNING id", [`Expiration browser test ${randomUUID()}`])).rows[0];
    const password = randomUUID(); const email = `${randomUUID()}@example.test`;
    await livePool.query("INSERT INTO merchant_users (merchant_id,email,role,password_hash) VALUES ($1,$2,'owner',$3)", [merchant.id, email, await hashPassword(password, config)]);
    await send("Fetch.disable");
    await send("Page.navigate", { url: `${base}/dashboard/payment-links/new` });
    await waitFor('document.querySelector("input[type=password]") !== null');
    await setField('input[type=text]', merchant.id); await setField('input[type=email]', email); await setField('input[type=password]', password);
    await submit(); await waitFor('document.querySelector("input[autocomplete=one-time-code]") !== null');
    await setField('input[autocomplete=one-time-code]', await js('document.querySelector("form code").textContent'));
    await submit(); await waitFor('document.querySelector("#payment-link-amount") !== null');
    await fill("1.500"); await choose("15-minutes");
    const before = Date.now(); await submit();
    await waitFor('location.pathname.startsWith("/dashboard/payment-links/") && !location.pathname.endsWith("/new") && document.querySelector(".dash-dl") !== null');
    const after = Date.now();
    const id = await js('location.pathname.split("/").at(-1)');
    const stored = (await livePool.query("SELECT amount_fils, expires_at, created_by_type, token FROM payment_links WHERE id = $1 AND merchant_id = $2", [id, merchant.id])).rows[0];
    assert.equal(Number(stored.amount_fils), 1500); assert.equal(stored.created_by_type, "merchant_session");
    assert.ok(stored.expires_at.getTime() >= before + 900000 && stored.expires_at.getTime() <= after + 900000);
    assert.equal(await js('document.body.textContent.includes("1.500 BHD")'), true);
    for (const expiration of [{ expiresInSeconds: 899 }, { expiresInSeconds: 10368001 }]) {
      assert.equal(await js(`fetch('/v1/merchants/${merchant.id}/payment-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ amountFils: 1500, ...expiration })})}).then(r=>r.status)`), 400);
    }
    await send("Page.navigate", { url: `${base}/pay/${stored.token}` });
    await waitFor('document.querySelector("#card-number") !== null');
    assert.equal(await js('document.body.textContent.includes("1.500 BHD")'), true);
    pass("REAL isolated browser password/OTP -> Vite proxy -> current API -> PostgreSQL creation, authoritative 15-minute deadline, direct bypass rejection and three-decimal checkout/detail display");
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${groups} browser verification groups; UI cases mocked${process.argv.includes("--live") ? "; additional live creation uses isolated API/Postgres" : "; all API requests intercepted"}`);
} finally {
  for (const file of baselineFiles) await unlink(file);
  socket?.close(); browser.kill();
  await liveVite?.close(); await liveApp?.close(); await livePool?.end();
}
