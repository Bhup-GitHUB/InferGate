import type { ProviderAdapter, ProviderInfo } from "./types";
import { anthropicMock, localVllmMock, openaiMock } from "./mocks";
import { assertEgressAllowed } from "./egress";
import { createAnthropicProvider, createOpenAICompatibleProvider } from "./http";

export * from "./types";
export { anthropicMock, localVllmMock, openaiMock } from "./mocks";
export { assertEgressAllowed, assertWebhookUrl, type EgressPolicy } from "./egress";
export { createAnthropicProvider, createOpenAICompatibleProvider } from "./http";

export interface ModelEntry {
  id: string;
  ownedBy: string;
  providerId: string;
  enabled: boolean;
  inputPricePer1k: number;
  outputPricePer1k: number;
  contextWindow: number;
}

const DEFAULT_MODELS: ModelEntry[] = [
  { id: "gpt-4o-mini", ownedBy: "openai", providerId: "openai", enabled: true, inputPricePer1k: 0.0005, outputPricePer1k: 0.0015, contextWindow: 128000 },
  { id: "gpt-4o", ownedBy: "openai", providerId: "openai", enabled: true, inputPricePer1k: 0.005, outputPricePer1k: 0.015, contextWindow: 128000 },
  { id: "claude-3-5-sonnet", ownedBy: "anthropic", providerId: "anthropic", enabled: true, inputPricePer1k: 0.003, outputPricePer1k: 0.015, contextWindow: 200000 },
  { id: "claude-3-haiku", ownedBy: "anthropic", providerId: "anthropic", enabled: true, inputPricePer1k: 0.0008, outputPricePer1k: 0.0024, contextWindow: 200000 },
  { id: "llama-3-8b", ownedBy: "local-vllm", providerId: "local-vllm", enabled: true, inputPricePer1k: 0.0001, outputPricePer1k: 0.0002, contextWindow: 8192 },
  { id: "mistral-7b", ownedBy: "local-vllm", providerId: "local-vllm", enabled: true, inputPricePer1k: 0.0001, outputPricePer1k: 0.0002, contextWindow: 32768 },
  { id: "auto", ownedBy: "infergate", providerId: "openai", enabled: true, inputPricePer1k: 0.0005, outputPricePer1k: 0.0015, contextWindow: 128000 },
];

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private models: ModelEntry[] = [...DEFAULT_MODELS];
  private live = new Set<string>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  markLive(id: string): void {
    this.live.add(id);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  providers(): ProviderInfo[] {
    return [...this.adapters.keys()].map((id) => ({ id, kind: this.live.has(id) ? "live" : "mock", enabled: true }));
  }

  listModels(): ModelEntry[] {
    return this.models.filter((m) => m.enabled);
  }

  resolveModel(alias: string): ModelEntry | undefined {
    if (alias === "auto") {
      return this.models.find((m) => m.id === "gpt-4o-mini");
    }
    return this.models.find((m) => m.id === alias && m.enabled);
  }

  adapterFor(alias: string): ProviderAdapter | undefined {
    const model = this.resolveModel(alias);
    if (!model) {
      return undefined;
    }
    const direct = this.adapters.get(model.providerId);
    if (direct && direct.supportsModel(alias)) {
      return direct;
    }
    return undefined;
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(openaiMock);
  registry.register(anthropicMock);
  registry.register(localVllmMock);
  return registry;
}

export interface EnvProviders {
  registry: ProviderRegistry;
  live: string[];
}

export function createRegistryFromEnv(env: Record<string, string | undefined>): EnvProviders {
  const registry = createDefaultRegistry();
  const live: string[] = [];
  const allowlist = (env["PROVIDER_ALLOWLIST"] ?? "api.openai.com,api.anthropic.com").split(",");
  const allowLoopback = (env["NODE_ENV"] ?? "development") !== "production";
  const timeoutMs = Number(env["ATTEMPT_TIMEOUT_MS"] ?? "30000");

  const openaiKey = env["OPENAI_API_KEY"];
  if (openaiKey) {
    const baseUrl = env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
    assertEgressAllowed(baseUrl, { allowlist, allowLoopback });
    registry.register(
      createOpenAICompatibleProvider({
        id: "openai",
        baseUrl,
        apiKey: openaiKey,
        aliases: ["gpt-4o-mini", "gpt-4o", "auto"],
        inputPricePer1k: 0.0005,
        outputPricePer1k: 0.0015,
        timeoutMs,
      }),
    );
    registry.markLive("openai");
    live.push("openai");
  }

  const anthropicKey = env["ANTHROPIC_API_KEY"];
  if (anthropicKey) {
    const baseUrl = env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
    assertEgressAllowed(baseUrl, { allowlist, allowLoopback });
    registry.register(
      createAnthropicProvider({
        id: "anthropic",
        baseUrl,
        apiKey: anthropicKey,
        aliases: ["claude-3-5-sonnet", "claude-3-haiku", "auto"],
        inputPricePer1k: 0.0008,
        outputPricePer1k: 0.0024,
        timeoutMs,
        anthropicVersion: "2023-06-01",
      }),
    );
    registry.markLive("anthropic");
    live.push("anthropic");
  }

  return { registry, live };
}
