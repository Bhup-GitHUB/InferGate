import { structuredLog } from "@infergate/otel";

const stream = process.env["BILLING_STREAM"] ?? "billing:usage";
const batchSize = Number(process.env["BILLING_BATCH_SIZE"] ?? "500");

async function tick(): Promise<void> {
  console.log(structuredLog({ level: "info", msg: "billing_worker_tick", stream, batchSize }));
}

await tick();
setInterval(() => {
  tick().catch((err: unknown) => {
    console.log(structuredLog({ level: "error", msg: "billing_worker_error", error: String(err) }));
  });
}, 5000);
