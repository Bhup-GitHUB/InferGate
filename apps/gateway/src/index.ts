import { generateKey } from "@infergate/auth";
import { structuredLog } from "@infergate/otel";
import { createApp } from "./app";
import { loadConfig } from "./lib/config";

const config = loadConfig(process.env as Record<string, string | undefined>);
const { app, keys } = createApp();

const seedOrg = process.env["SEED_ORG_ID"] ?? "org_demo";
const seedScopes = (process.env["SEED_SCOPES"] ?? "chat:write,models:read,usage:read,keys:write").split(",");
const printSeed = process.env["PRINT_SEED_KEY"] === "1";
const generated = generateKey(seedOrg, seedScopes, config.pepper, config.pepperVersion);
await keys.save({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  ...generated.record,
});

console.log(structuredLog({ level: "info", msg: "gateway_boot", port: config.port, orgId: seedOrg }));
console.log(structuredLog({ level: "info", msg: "seed_key", prefix: generated.prefix, orgId: seedOrg }));
if (printSeed) {
  process.stderr.write(`SEED_API_KEY=${generated.publicKey}\n`);
}

export default {
  port: config.port,
  fetch: app.fetch,
};
