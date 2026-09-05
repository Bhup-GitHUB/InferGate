export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface InternalChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  orgId: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  providerId: string;
  modelId: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  usage?: TokenUsage;
}

export interface HealthStatus {
  ok: boolean;
  latencyMs: number;
  checkedAt: number;
}

export interface ProviderAdapter {
  readonly id: string;
  chatCompletion(req: InternalChatRequest, signal: AbortSignal): Promise<CompletionResult>;
  streamCompletion(req: InternalChatRequest, signal: AbortSignal): AsyncGenerator<StreamChunk>;
  healthCheck(): Promise<HealthStatus>;
  supportsModel(alias: string): boolean;
}

export interface ProviderInfo {
  id: string;
  kind: string;
  enabled: boolean;
}
