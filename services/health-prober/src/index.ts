import { createDefaultRegistry } from "@infergate/providers";
import { structuredLog } from "@infergate/otel";

const registry = createDefaultRegistry();

async function probe(): Promise<void> {
  for (const info of registry.providers()) {
    const adapter = registry.get(info.id);
    if (!adapter) {
      continue;
    }
    try {
      const status = await adapter.healthCheck();
      console.log(structuredLog({ level: "info", msg: "provider_probe", provider: info.id, ok: status.ok, latencyMs: status.latencyMs }));
    } catch (err) {
      console.log(structuredLog({ level: "error", msg: "provider_probe_failed", provider: info.id, error: String(err) }));
    }
  }
}

await probe();
setInterval(() => {
  probe().catch((err: unknown) => {
    console.log(structuredLog({ level: "error", msg: "probe_error", error: String(err) }));
  });
}, 30000);
