import type {
  CompletionResult,
  HealthStatus,
  InternalChatRequest,
  ProviderAdapter,
  StreamChunk,
} from "./types";

export interface HttpProviderOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  aliases: string[];
  inputPricePer1k: number;
  outputPricePer1k: number;
  timeoutMs: number;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new Error("aborted");
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("aborted")), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function createOpenAICompatibleProvider(options: HttpProviderOptions): ProviderAdapter {
  return {
    id: options.id,
    supportsModel(alias: string): boolean {
      return options.aliases.includes(alias);
    },
    async chatCompletion(req: InternalChatRequest, signal: AbortSignal): Promise<CompletionResult> {
      const started = Date.now();
      const res = await withTimeout(
        fetch(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
            ...(req.requestId ? { "x-request-id": req.requestId } : {}),
          },
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            max_tokens: req.maxTokens,
            temperature: req.temperature,
            stream: false,
          }),
          signal,
        }),
        options.timeoutMs,
        signal,
      );
      if (!res.ok) {
        throw new Error(`${options.id} upstream ${res.status}`);
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      const inputTokens = body.usage?.prompt_tokens ?? req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
      const outputTokens = body.usage?.completion_tokens ?? estimateTokens(text);
      const latencyMs = Date.now() - started;
      return {
        text,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: (inputTokens / 1000) * options.inputPricePer1k + (outputTokens / 1000) * options.outputPricePer1k,
          latencyMs,
        },
        providerId: options.id,
        modelId: req.model,
      };
    },
    async *streamCompletion(req: InternalChatRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
      const res = await withTimeout(
        fetch(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
            ...(req.requestId ? { "x-request-id": req.requestId } : {}),
          },
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            max_tokens: req.maxTokens,
            temperature: req.temperature,
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal,
        }),
        options.timeoutMs,
        signal,
      );
      if (!res.ok || !res.body) {
        throw new Error(`${options.id} upstream ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let streamedInput = 0;
      let streamedOutput = 0;
      const inputTokens = req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (signal.aborted) {
          throw new Error("aborted");
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) {
              continue;
            }
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              continue;
            }
            try {
              const payload = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
              if (payload.usage) {
                streamedInput = payload.usage.prompt_tokens ?? streamedInput;
                streamedOutput = payload.usage.completion_tokens ?? streamedOutput;
              }
              const delta = payload.choices?.[0]?.delta?.content ?? "";
              if (delta !== "") {
                text += delta;
                yield { delta, done: false };
              }
            } catch {
              continue;
            }
          }
        }
      }
      const outputTokens = streamedOutput > 0 ? streamedOutput : estimateTokens(text);
      const finalInput = streamedInput > 0 ? streamedInput : inputTokens;
      yield {
        delta: "",
        done: true,
        usage: {
          inputTokens: finalInput,
          outputTokens,
          costUsd: (finalInput / 1000) * options.inputPricePer1k + (outputTokens / 1000) * options.outputPricePer1k,
          latencyMs: 0,
        },
      };
    },
    async healthCheck(): Promise<HealthStatus> {
      const started = Date.now();
      try {
        const res = await fetch(`${options.baseUrl}/models`, {
          headers: { authorization: `Bearer ${options.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        return { ok: res.ok, latencyMs: Date.now() - started, checkedAt: Date.now() };
      } catch {
        return { ok: false, latencyMs: Date.now() - started, checkedAt: Date.now() };
      }
    },
  };
}

export interface AnthropicProviderOptions extends HttpProviderOptions {
  anthropicVersion: string;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ProviderAdapter {
  const base = createOpenAICompatibleProvider({ ...options, baseUrl: `${options.baseUrl}/v1` });
  void base;
  return {
    id: options.id,
    supportsModel(alias: string): boolean {
      return options.aliases.includes(alias);
    },
    async chatCompletion(req: InternalChatRequest, signal: AbortSignal): Promise<CompletionResult> {
      const started = Date.now();
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const messages = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));
      const res = await withTimeout(
        fetch(`${options.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": options.anthropicVersion,
            "content-type": "application/json",
            ...(req.requestId ? { "x-request-id": req.requestId } : {}),
          },
          body: JSON.stringify({
            model: req.model,
            system: system === "" ? undefined : system,
            messages,
            max_tokens: req.maxTokens ?? 1024,
            temperature: req.temperature,
          }),
          signal,
        }),
        options.timeoutMs,
        signal,
      );
      if (!res.ok) {
        throw new Error(`${options.id} upstream ${res.status}`);
      }
      const body = (await res.json()) as {
        content?: { text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = body.content?.map((c) => c.text ?? "").join("") ?? "";
      const inputTokens = body.usage?.input_tokens ?? req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
      const outputTokens = body.usage?.output_tokens ?? estimateTokens(text);
      const latencyMs = Date.now() - started;
      return {
        text,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: (inputTokens / 1000) * options.inputPricePer1k + (outputTokens / 1000) * options.outputPricePer1k,
          latencyMs,
        },
        providerId: options.id,
        modelId: req.model,
      };
    },
    async *streamCompletion(req: InternalChatRequest, signal: AbortSignal): AsyncGenerator<StreamChunk> {
      const started = Date.now();
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const messages = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));
      const res = await withTimeout(
        fetch(`${options.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": options.anthropicVersion,
            "content-type": "application/json",
            ...(req.requestId ? { "x-request-id": req.requestId } : {}),
          },
          body: JSON.stringify({
            model: req.model,
            system: system === "" ? undefined : system,
            messages,
            max_tokens: req.maxTokens ?? 1024,
            temperature: req.temperature,
            stream: true,
          }),
          signal,
        }),
        options.timeoutMs,
        signal,
      );
      if (!res.ok || !res.body) {
        throw new Error(`${options.id} upstream ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let streamedInput = 0;
      let streamedOutput = 0;
      const inputTokens = req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (signal.aborted) {
          throw new Error("aborted");
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          let event = "";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data = line.slice(5).trim();
            }
          }
          if (event !== "content_block_delta" && event !== "message_start" && event !== "message_delta") {
            continue;
          }
          try {
            const payload = JSON.parse(data) as { delta?: { text?: string }; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } };
            if (payload.message?.usage?.input_tokens) {
              streamedInput = payload.message.usage.input_tokens;
            }
            if (payload.usage?.output_tokens) {
              streamedOutput = payload.usage.output_tokens;
            }
            const delta = payload.delta?.text ?? "";
            if (delta !== "") {
              text += delta;
              yield { delta, done: false };
            }
          } catch {
            continue;
          }
        }
      }
      const outputTokens = streamedOutput > 0 ? streamedOutput : estimateTokens(text);
      const finalInput = streamedInput > 0 ? streamedInput : inputTokens;
      yield {
        delta: "",
        done: true,
        usage: {
          inputTokens: finalInput,
          outputTokens,
          costUsd: (finalInput / 1000) * options.inputPricePer1k + (outputTokens / 1000) * options.outputPricePer1k,
          latencyMs: Date.now() - started,
        },
      };
    },
    async healthCheck(): Promise<HealthStatus> {
      return { ok: true, latencyMs: 1, checkedAt: Date.now() };
    },
  };
}
