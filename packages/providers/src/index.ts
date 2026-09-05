import type { ProviderAdapter, ProviderInfo } from "./types";
import { anthropicMock, localVllmMock, openaiMock } from "./mocks";

export * from "./types";
export { anthropicMock, localVllmMock, openaiMock } from "./mocks";
export { assertEgressAllowed, assertWebhookUrl, type EgressPolicy } from "./egress";

export interface ModelEntry {
  id: string;
  ownedBy: string;
  providerId: string;
  enabled: boolean;
}

const DEFAULT_MODELS: ModelEntry[] = [
  { id: "gpt-4o-mini", ownedBy: "openai", providerId: "openai", enabled: true },
  { id: "gpt-4o", ownedBy: "openai", providerId: "openai", enabled: true },
  { id: "claude-3-5-sonnet", ownedBy: "anthropic", providerId: "anthropic", enabled: true },
  { id: "claude-3-haiku", ownedBy: "anthropic", providerId: "anthropic", enabled: true },
  { id: "llama-3-8b", ownedBy: "local-vllm", providerId: "local-vllm", enabled: true },
  { id: "mistral-7b", ownedBy: "local-vllm", providerId: "local-vllm", enabled: true },
  { id: "auto", ownedBy: "infergate", providerId: "openai", enabled: true },
];

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private models: ModelEntry[] = [...DEFAULT_MODELS];

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  providers(): ProviderInfo[] {
    return [...this.adapters.keys()].map((id) => ({ id, kind: "mock", enabled: true }));
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
