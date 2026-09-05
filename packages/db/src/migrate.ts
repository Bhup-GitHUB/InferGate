import { readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const dir = new URL("../migrations/", import.meta.url).pathname;
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const sql = postgres(connectionString, { max: 1 });

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
for (const file of files) {
  const done = await sql`SELECT 1 FROM schema_migrations WHERE name = ${file}`;
  if (done.length > 0) {
    continue;
  }
  const text = await Bun.file(join(dir, file)).text();
  await sql.unsafe(text);
  await sql`INSERT INTO schema_migrations (name) VALUES (${file})`;
  console.log(JSON.stringify({ migrated: file }));
}

await sql.end();
