import type {
  CompletionResult,
  HealthStatus,
  InternalChatRequest,
  ProviderAdapter,
  StreamChunk,
} from "./types";

export interface MockBehavior {
  id: string;
  latencyMinMs: number;
  latencyMaxMs: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
  aliases: string[];
  failureRate: number;
}

function countTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function randomLatency(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function splitChunks(text: string, parts: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  const per = Math.max(1, Math.ceil(words.length / parts));
  for (let i = 0; i < words.length; i += per) {
    out.push(words.slice(i, i + per).join(" "));
  }
  return out;
}

export function createMockProvider(behavior: MockBehavior): ProviderAdapter {
  return {
    id: behavior.id,
    supportsModel(alias: string): boolean {
      return behavior.aliases.includes(alias) || alias === "auto";
    },
    async chatCompletion(req: InternalChatRequest, signal: AbortSignal): Promise<CompletionResult> {
      const started = Date.now();
      if (Math.random() < behavior.failureRate) {
        throw new Error(`${behavior.id} simulated upstream failure`);
      }
      const delay = randomLatency(behavior.latencyMinMs, behavior.latencyMaxMs);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
      const prompt = lastUser ? lastUser.content : "";
      const text = `Mock response from ${behavior.id} for model ${req.model}: received ${req.messages.length} message(s). Last prompt length ${prompt.length} chars.`;
      const inputTokens = req.messages.reduce((n, m) => n + countTokens(m.content), 0);
      const outputTokens = countTokens(text);
      const latencyMs = Date.now() - started;
      const costUsd = (inputTokens / 1000) * behavior.inputPricePer1k + (outputTokens / 1000) * behavior.outputPricePer1k;
      return {
        text,
        usage: { inputTokens, outputTokens, costUsd, latencyMs },
        providerId: behavior.id,
        modelId: req.model,
      };
    },
    async *streamCompletion(req: InternalChatRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
      const started = Date.now();
      if (Math.random() < behavior.failureRate) {
        throw new Error(`${behavior.id} simulated upstream failure`);
      }
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
      const prompt = lastUser ? lastUser.content : "";
      const full = `Mock stream from ${behavior.id} for model ${req.model}: received ${req.messages.length} message(s). Last prompt length ${prompt.length} chars. Tokens arrive incrementally.`;
      const parts = splitChunks(full, 6);
      for (const part of parts) {
        if (signal.aborted) {
          throw new Error("aborted");
        }
        await new Promise((r) => setTimeout(r, randomLatency(behavior.latencyMinMs / 6, behavior.latencyMaxMs / 6)));
        yield { delta: part + " ", done: false };
      }
      const inputTokens = req.messages.reduce((n, m) => n + countTokens(m.content), 0);
      const outputTokens = countTokens(full);
      const latencyMs = Date.now() - started;
      const costUsd = (inputTokens / 1000) * behavior.inputPricePer1k + (outputTokens / 1000) * behavior.outputPricePer1k;
      yield {
        delta: "",
        done: true,
        usage: { inputTokens, outputTokens, costUsd, latencyMs },
      };
    },
    async healthCheck(): Promise<HealthStatus> {
      const started = Date.now();
      await new Promise((r) => setTimeout(r, randomLatency(2, 12)));
      return { ok: true, latencyMs: Date.now() - started, checkedAt: Date.now() };
    },
  };
}

export const openaiMock = createMockProvider({
  id: "openai",
  latencyMinMs: 120,
  latencyMaxMs: 400,
  inputPricePer1k: 0.0005,
  outputPricePer1k: 0.0015,
  aliases: ["gpt-4o-mini", "gpt-4o", "auto"],
  failureRate: 0,
});

export const anthropicMock = createMockProvider({
  id: "anthropic",
  latencyMinMs: 180,
  latencyMaxMs: 520,
  inputPricePer1k: 0.0008,
  outputPricePer1k: 0.0024,
  aliases: ["claude-3-5-sonnet", "claude-3-haiku", "auto"],
  failureRate: 0,
});

export const localVllmMock = createMockProvider({
  id: "local-vllm",
  latencyMinMs: 40,
  latencyMaxMs: 160,
  inputPricePer1k: 0.0001,
  outputPricePer1k: 0.0002,
  aliases: ["llama-3-8b", "mistral-7b", "auto"],
  failureRate: 0,
});
