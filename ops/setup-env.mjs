import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

// Exclusive creation preserves existing encryption keys and tokens on reruns.
const destination = new URL("./.env.docker", import.meta.url);
try {
  writeFileSync(destination, [
    "# Local development only. Do not commit this file.",
    "NODE_ENV=development",
    "PORT=3000",
    `WEBHOOK_SECRET_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    `SETTLEMENT_INTERNAL_TOKEN=${randomBytes(32).toString("hex")}`,
    `ACQUIRER_CALLBACK_SIGNING_SECRET=${randomBytes(32).toString("hex")}`,
    "FEATURE_REFUNDS=true",
    "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  console.log("Created ops/.env.docker with fresh local development values.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.error("ops/.env.docker already exists; preserving its keys and tokens.");
  } else {
    throw error;
  }
}
