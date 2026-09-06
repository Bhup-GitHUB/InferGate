export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  idempotencyKey?: string;
  cacheTtl?: number;
}

export interface ChatCompletion {
  id: string;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  provider: string | null;
}

export interface ModelSummary {
  id: string;
  ownedBy: string;
}

export class InferGateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class InferGate {
  private baseUrl: string;
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let code = "request_failed";
      let message = `request failed with ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        return Promise.reject(new InferGateError(res.status, code, message));
      }
      throw new InferGateError(res.status, code, message);
    }
    return res;
  }

  async models(): Promise<ModelSummary[]> {
    const res = await this.request("/v1/models");
    const body = (await res.json()) as { data: { id: string; owned_by: string }[] };
    return body.data.map((m) => ({ id: m.id, ownedBy: m.owned_by }));
  }

  async chat(params: ChatParams): Promise<ChatCompletion> {
    const res = await this.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        idempotency_key: params.idempotencyKey,
        cache_ttl: params.cacheTtl,
      }),
    });
    const body = (await res.json()) as {
      id: string;
      model: string;
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      id: body.id,
      model: body.model,
      content: body.choices[0]?.message?.content ?? "",
      promptTokens: body.usage.prompt_tokens,
      completionTokens: body.usage.completion_tokens,
      provider: res.headers.get("x-infergate-provider"),
    };
  }

  async *stream(params: ChatParams): AsyncGenerator<string> {
    const res = await this.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: params.model, messages: params.messages, stream: true }),
    });
    if (!res.body) {
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
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
            const payload = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const token = payload.choices?.[0]?.delta?.content ?? "";
            if (token !== "") {
              yield token;
            }
          } catch {
            continue;
          }
        }
      }
    }
  }

  async usage(): Promise<{ requests: number; costUsd: number }> {
    const res = await this.request("/v1/usage");
    return res.json();
  }
}
