import postgres from "postgres";
import { structuredLog } from "@infergate/otel";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const intervalMs = Number(process.env["ROLLUP_INTERVAL_MS"] ?? "3600000");
const sql = postgres(connectionString, { max: 2 });

export async function rollupOnce(): Promise<{ days: number; invoices: number }> {
  const days = await sql`
    INSERT INTO usage_daily (org_id, date, model, input_tokens, output_tokens, cost_usd, requests)
    SELECT org_id, to_char(created_at, 'YYYY-MM-DD'), model,
           SUM(input_tokens)::bigint, SUM(output_tokens)::bigint,
           SUM(cost_usd), COUNT(*)::bigint
    FROM requests
    WHERE status = 'ok'
    GROUP BY org_id, to_char(created_at, 'YYYY-MM-DD'), model
    ON CONFLICT (org_id, date, model) DO UPDATE SET
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      cost_usd = EXCLUDED.cost_usd,
      requests = EXCLUDED.requests
    RETURNING org_id
  `;
  const month = new Date().toISOString().slice(0, 7);
  const spend = await sql`
    SELECT org_id, COALESCE(SUM(cost_usd), 0)::float AS total
    FROM requests
    WHERE status = 'ok' AND to_char(created_at, 'YYYY-MM') = ${month}
    GROUP BY org_id
  `;
  let invoices = 0;
  await sql`DELETE FROM invoices WHERE status = 'draft' AND period_start = ${`${month}-01`}`;
  for (const row of spend as unknown as { org_id: string; total: number }[]) {
    await sql`
      INSERT INTO invoices (org_id, period_start, period_end, amount_usd, status)
      VALUES (${row.org_id}, ${`${month}-01`}, ${month}, ${String(row.total)}, 'draft')
    `;
    invoices += 1;
  }
  return { days: days.length, invoices };
}

const once = process.env["RUN_ONCE"] === "1";
const result = await rollupOnce();
console.log(structuredLog({ level: "info", msg: "billing_rollup", ...result }));
if (!once) {
  setInterval(() => {
    rollupOnce()
      .then((r) => console.log(structuredLog({ level: "info", msg: "billing_rollup", ...r })))
      .catch((err: unknown) => console.log(structuredLog({ level: "error", msg: "billing_rollup_error", error: String(err) })));
  }, intervalMs);
}
await sql.end({ timeout: once ? 5 : 0 });
