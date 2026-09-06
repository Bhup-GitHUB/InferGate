import postgres from "postgres";
import { generateKey } from "@infergate/auth";
import { structuredLog } from "@infergate/otel";
import { createApp } from "./app";
import { loadConfig } from "./lib/config";
import { beginDrain, inflightCount } from "./middleware/tracing";

const config = loadConfig(process.env as Record<string, string | undefined>);
const { app, keys, db } = createApp();

const seedOrg = process.env["SEED_ORG_ID"] ?? crypto.randomUUID();
const seedScopes = (process.env["SEED_SCOPES"] ?? "chat:write,models:read,usage:read,billing:read,keys:write,admin:write").split(",");
const printSeed = process.env["PRINT_SEED_KEY"] === "1";

if (db && process.env["DATABASE_URL"]) {
  const admin = postgres(process.env["DATABASE_URL"] as string, { max: 1 });
  await admin`
    INSERT INTO organizations (id, name, plan) VALUES (${seedOrg}, 'seed org', 'pro')
    ON CONFLICT (id) DO NOTHING
  `;
  await admin.end();
}

const generated = generateKey(seedOrg, seedScopes, config.pepper, config.pepperVersion);
await keys.save({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  ...generated.record,
});

console.log(structuredLog({ level: "info", msg: "gateway_boot", port: config.port, orgId: seedOrg, store: db ? "postgres" : "memory" }));
console.log(structuredLog({ level: "info", msg: "seed_key", prefix: generated.prefix, orgId: seedOrg }));
if (printSeed) {
  process.stderr.write(`SEED_API_KEY=${generated.publicKey}\n`);
}

function shutdown(signal: string): void {
  console.log(structuredLog({ level: "info", msg: "shutdown_start", signal }));
  beginDrain();
  const deadline = Date.now() + 25000;
  const wait = (): void => {
    if (inflightCount() === 0 || Date.now() >= deadline) {
      console.log(structuredLog({ level: "info", msg: "shutdown_done", inflight: inflightCount() }));
      process.exit(0);
    } else {
      setTimeout(wait, 250);
    }
  };
  wait();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default {
  port: config.port,
  fetch: app.fetch,
};
