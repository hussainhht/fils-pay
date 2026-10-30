// Local screenshot fixture only. No API proxy, database or acquirer connection.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/web", import.meta.url));
const before = process.argv.includes("--before");
const baselineFiles = ["CheckoutPage.tsx", "CheckoutFrame.tsx", "CheckoutPage.css"];
const baseline = new Map(before ? baselineFiles.map((file) => [file,
  execFileSync("git", ["show", `2ee8df0a691e0bc0fe3624b4aa40e90f20d87617:apps/web/src/pages/checkout/${file}`], { encoding: "utf8" }),
]) : []);
const server = await createServer({
  configFile: false, root,
  plugins: [{
    name: "checkout-local-fixtures", enforce: "pre",
    load(id) {
      const normalized = id.replaceAll("\\", "/");
      const file = baselineFiles.find((name) => normalized.endsWith(`/pages/checkout/${name}`));
      return file && before ? baseline.get(file) : null;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/v1/")) return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
        const match = /^\/v1\/payment-links\/([^/?]+)(\/pay)?$/.exec(req.url);
        if (!match) return send(404, { error: "preview_only" });
        const scenario = match[1];
        if (scenario === "invalid") return send(404, { error: "payment_link_not_found" });
        if (!match[2]) {
          if (scenario === "loading") await new Promise((resolve) => setTimeout(resolve, 8000));
          return send(200, {
            token: scenario, merchantDisplayName: "Preview Retail Co", amountFils: 10000, currency: "BHD",
            description: "Sample order · checkout preview", reference: "PREVIEW-001",
            expiresAt: "2030-12-31T00:00:00Z",
            status: ["expired", "paid", "canceled", "processing"].includes(scenario) ? scenario : "active",
          });
        }
        if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
        // Synthetic card values stay in request memory and are never printed or persisted.
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return send(413, { error: "preview_input_too_large" });
        }
        let input;
        try { input = JSON.parse(body); } catch { return send(400, { error: "invalid_request" }); }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const pan = String(input.card?.pan ?? "");
        if (scenario === "declined" || pan.endsWith("0002") || pan.endsWith("0119")) {
          return send(402, { error: "acquirer_declined", stage: "authorize" });
        }
        if (scenario === "error" || pan.endsWith("0069")) return send(502, { error: "acquirer_error" });
        return send(200, { status: "paid", transactionId: "preview-transaction-001", amountFils: 10000, paidAt: "2026-10-30T12:00:00Z" });
      });
    },
  }, react()],
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
});
await server.listen();
console.log(`Checkout ${before ? "BEFORE" : "AFTER"} fixture: http://127.0.0.1:5175/pay/preview`);
console.log("Synthetic responses only. Scenarios: preview, declined, error, loading, invalid, expired, paid, canceled, processing.");
