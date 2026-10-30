// Installed Chromium only; no dependencies or real API/payment calls.
// Run with the local Vite preview on :5173. --baseline loads the HEAD page.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = "http://127.0.0.1:5173";
const baseline = process.argv.includes("--baseline");
const browserPath = process.argv.find((arg) => arg.startsWith("--browser="))?.slice(10)
  ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "filspay-amount-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
let baselineFile;
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
  let role = "owner";
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const link = { id: "sandbox-link", token: "sandbox-token", amountFils: 1500, status: "active", currency: "BHD", reference: "Order 42", description: "Test order", expiresAt, url: `${base}/pay/sandbox-token`, createdAt: new Date().toISOString() };
  const fulfill = (requestId, status, body, contentType = "application/json") => send("Fetch.fulfillRequest", { requestId, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: contentType }], body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64") });
  if (baseline) {
    const source = execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/").replace(/\/$/, "")}`, "show", "HEAD:apps/web/src/pages/payment-links/PaymentLinkCreatePage.tsx"], { cwd: root, encoding: "utf8", windowsHide: true });
    const candidate = join(root, "apps/web/src/pages/payment-links/PaymentLinkCreateBaselineVerification.tsx");
    await writeFile(candidate, source, { flag: "wx" }); baselineFile = candidate;
  }
  listeners.set("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const path = new URL(request.url).pathname;
      if (baseline && path.endsWith("/PaymentLinkCreatePage.tsx")) {
        const source = await (await fetch(`${base}/src/pages/payment-links/PaymentLinkCreateBaselineVerification.tsx`)).text();
        await fulfill(requestId, 200, source, "text/javascript");
      } else if (path === "/v1/auth/me") {
        await fulfill(requestId, 200, { merchantUserId: "sandbox-user", role, email: "sandbox@example.test", merchant: { id: "sandbox-merchant", displayName: "Sandbox Merchant", onboardingStatus: "approved", refundsEnabled: true } });
      } else if (request.method === "POST") {
        requests.push({ path, body: JSON.parse(request.postData) });
        await fulfill(requestId, responseStatus, responseStatus === 201 ? link : { error: "sandbox_rejected", message: "Sandbox creation rejected" });
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
  await fill("1.5"); await submit(); assert.equal(requests.length, 0);
  assert.equal(await js('document.querySelector(".dash-error").textContent.includes("Expiry")'), true);
  await js(`const e=document.querySelector('input[type="datetime-local"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2020-01-01T12:00'); e.dispatchEvent(new Event('input',{bubbles:true}));`);
  await submit(); assert.equal(requests.length, 0);
  assert.equal(await js('document.querySelector(".dash-error").textContent.includes("future")'), true);
  pass("zero/unsafe amounts and missing/past expiry send no creation request");

  await js(`const fields=document.querySelectorAll('form input'); for(const [n,v] of [[1,' Order 42 '],[2,' Test order '],[3,${JSON.stringify(expiresAt.slice(0, 16))}]]) {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(fields[n],v);fields[n].dispatchEvent(new Event('input',{bubbles:true}));}`);
  for (const [draft, fils] of [["1.5", 1500], ["0.001", 1], ["1.", 1000], ["9007199254740.991", Number.MAX_SAFE_INTEGER]]) {
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
  assert.deepEqual(errors, []);
  console.log(`PASS ${groups} browser verification groups; all API requests intercepted with sandbox fixtures`);
} finally {
  if (baselineFile) await unlink(baselineFile);
  socket?.close(); browser.kill();
}
