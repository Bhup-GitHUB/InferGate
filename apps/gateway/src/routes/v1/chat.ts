import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { chatCompletionRequestSchema, errorBody } from "@infergate/schemas";
import { observeProviderError, observeRequest, startSpan } from "@infergate/otel";
import type { ProviderRegistry } from "@infergate/providers";
import type { GatewayConfig } from "../../lib/config";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { UsageStore } from "../../lib/store";
import { requireScope } from "../../middleware/auth";

export interface ChatDeps {
  registry: ProviderRegistry;
  usage: UsageStore;
  config: GatewayConfig;
}

export function chatRoutes(deps: ChatDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/chat/completions", async (c) => {
    if (!requireScope(c, "chat:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const span = startSpan("gateway.chat");
    span.setAttribute("orgId", auth.orgId);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const parsed = chatCompletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(errorBody(parsed.error.issues[0]?.message ?? "Invalid request", "invalid_request_error", "validation_error"), 400);
    }
    const req = parsed.data;
    const adapter = deps.registry.adapterFor(req.model);
    if (!adapter) {
      return c.json(errorBody(`Model not found: ${req.model}`, "invalid_request_error", "model_not_found"), 400);
    }
    const resolved = deps.registry.resolveModel(req.model);
    const modelId = resolved?.id ?? req.model;
    span.setAttribute("provider", adapter.id);
    span.setAttribute("model", modelId);

    if (req.idempotency_key) {
      const existing = await deps.usage.findByIdempotencyKey(req.idempotency_key).catch(() => null);
      if (existing && existing.orgId === auth.orgId) {
        return c.json(errorBody("Duplicate request", "invalid_request_error", "idempotent_replay"), 409);
      }
    }

    const internal = {
      model: modelId,
      messages: req.messages,
      maxTokens: req.max_tokens,
      temperature: req.temperature,
      orgId: auth.orgId,
    };

    if (!req.stream) {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), deps.config.streamMaxDurationMs);
      try {
        const result = await adapter.chatCompletion(internal, controller.signal);
        const latencyMs = Date.now() - started;
        await deps.usage.insert({
          idempotencyKey: req.idempotency_key ?? null,
          orgId: auth.orgId,
          keyId: auth.keyId,
          providerId: result.providerId,
          model: modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs,
          costUsd: result.usage.costUsd,
          status: "ok",
          error: null,
        });
        observeRequest(result.providerId, modelId, latencyMs, result.usage.inputTokens, result.usage.outputTokens, result.usage.costUsd);
        const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
        c.header("x-infergate-provider", result.providerId);
        c.header("x-infergate-retry", "0");
        return c.json({
          id: completionId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: result.usage.inputTokens,
            completion_tokens: result.usage.outputTokens,
            total_tokens: result.usage.inputTokens + result.usage.outputTokens,
          },
        });
      } catch (err) {
        observeProviderError(adapter.id);
        const message = err instanceof Error ? err.message : "Provider error";
        if (message === "aborted") {
          return c.json(errorBody("Request timed out", "provider_error", "provider_timeout"), 502);
        }
        await deps.usage.insert({
          idempotencyKey: null,
          orgId: auth.orgId,
          keyId: auth.keyId,
          providerId: adapter.id,
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - started,
          costUsd: 0,
          status: "error",
          error: message,
        });
        return c.json(errorBody("Provider unavailable", "provider_error", "provider_unavailable"), 502);
      } finally {
        clearTimeout(timeout);
        span.end();
      }
    }

    const streamController = new AbortController();
    const resetIdle = () => setTimeout(() => streamController.abort(), deps.config.streamIdleTimeoutMs);
    let idleTimer = resetIdle();
    const maxTimer = setTimeout(() => streamController.abort(), deps.config.streamMaxDurationMs);
    const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const startedAt = Date.now();
    let accInput = 0;
    let accOutput = 0;
    let accCost = 0;
    let settled = false;

    c.header("x-infergate-provider", adapter.id);
    c.header("x-infergate-retry", "0");
    return streamSSE(c, async (stream) => {
      try {
        const gen = adapter.streamCompletion(internal, streamController.signal);
        for await (const chunk of gen) {
          if (stream.aborted) {
            break;
          }
          clearTimeout(idleTimer);
          idleTimer = resetIdle();
          if (chunk.usage) {
            accInput = chunk.usage.inputTokens;
            accOutput = chunk.usage.outputTokens;
            accCost = chunk.usage.costUsd;
          }
          if (!chunk.done) {
            await stream.writeSSE({
              data: JSON.stringify({
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null }],
              }),
            });
          }
        }
        await stream.writeSSE({ data: "[DONE]" });
        settled = true;
      } catch {
        observeProviderError(adapter.id);
        await stream.writeSSE({
          data: JSON.stringify({ error: { message: "Provider unavailable", type: "provider_error" } }),
        });
      } finally {
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        const latencyMs = Date.now() - startedAt;
        await deps.usage
          .insert({
            idempotencyKey: null,
            orgId: auth.orgId,
            keyId: auth.keyId,
            providerId: adapter.id,
            model: modelId,
            inputTokens: accInput,
            outputTokens: accOutput,
            latencyMs,
            costUsd: accCost,
            status: settled ? "ok" : "error",
            error: settled ? null : "stream_interrupted",
          })
          .catch(() => undefined);
        observeRequest(adapter.id, modelId, latencyMs, accInput, accOutput, accCost);
        span.end();
      }
    });
  });

  return app;
}
