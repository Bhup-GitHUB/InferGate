import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { structuredLog } from "@infergate/otel";

const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];

let sdk: NodeSDK | null = null;

export function startTelemetry(): void {
  if (!endpoint) {
    return;
  }
  try {
    const exporter = new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` });
    sdk = new NodeSDK({ traceExporter: exporter, serviceName: "infergate-gateway" });
    sdk.start();
    console.log(structuredLog({ level: "info", msg: "otel_enabled", endpoint }));
  } catch (err) {
    console.log(structuredLog({ level: "error", msg: "otel_failed", error: String(err) }));
  }
}

export async function stopTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown().catch(() => undefined);
    sdk = null;
  }
}
