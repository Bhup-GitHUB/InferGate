import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { chatCompletionRequestSchema, errorBody } from "@infergate/schemas";
import { observeProviderError, observeRequest, startSpan } from "@infergate/otel";
import type { ProviderAdapter, ProviderRegistry } from "@infergate/providers";
import { RoutingEngine, pickRule } from "@infergate/routing";
import { cacheGet, cacheKey, cacheSet, type CachedCompletion } from "@infergate/cache";
import type { Redis } from "ioredis";
import type { GatewayConfig } from "../../lib/config";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { UsageStore } from "../../lib/store";
import { Notifier, type WebhookEndpoints } from "../../lib/webhooks";
import type { RuleCache } from "../../lib/rules";
import { requireScope } from "../../middleware/auth";

export interface ChatDeps {
  registry: ProviderRegistry;
  routing: RoutingEngine;
  usage: UsageStore;
  config: GatewayConfig;
  redis: Redis | null;
  webhooks: WebhookEndpoints;
  notify: Notifier;
  rules: RuleCache;
}

const AUTO_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet",
  "local-vllm": "llama-3-8b",
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

function withAttemptTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onParent = () => {
    clearTimeout(timer);
    controller.abort();
  };
  parent.addEventListener("abort", onParent, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}

export function chatRoutes(deps: ChatDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const inflight = new Set<string>();

  app.post("/chat/completions", async (c) => {
    if (!requireScope(c, "chat:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    const span = startSpan("gateway.chat");
    span.setAttribute("orgId", auth.orgId);

    const failWithOutage = (providerId: string): void => {
      const before = deps.routing.circuitState(providerId);
      deps.routing.reportFailure(providerId);
      if (before !== "open" && deps.routing.circuitState(providerId) === "open") {
        deps.notify.emit(deps.webhooks, auth.orgId, "provider.outage", { provider: providerId });
        if (deps.redis) {
          deps.redis
            .set(`breaker:${providerId}`, "open", "PX", deps.config.breakerCooldownMs)
            .catch(() => undefined);
        }
      }
    };

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
    const resolved = deps.registry.resolveModel(req.model);
    if (!resolved) {
      return c.json(errorBody(`Model not found: ${req.model}`, "invalid_request_error", "model_not_found"), 400);
    }
    const modelId = resolved.id;
    span.setAttribute("model", modelId);

    const idemScope = req.idempotency_key ? `${auth.orgId}:${req.idempotency_key}` : null;
    if (idemScope && inflight.has(idemScope)) {
      return c.json(errorBody("Duplicate request in flight", "invalid_request_error", "idempotent_replay"), 409);
    }

    const orgRules = await deps.rules.forOrg(auth.orgId).catch(() => []);
    const rule = pickRule(orgRules, deps.routing.getDefaultStrategy(), auth.orgId, req.model, modelId);
    const routingAlias = req.model === "auto" ? "auto" : modelId;
    const candidateIds = deps.routing.candidatesFor(routingAlias);
    const ordered = deps.routing.orderCandidates(candidateIds, rule.strategy, rule).slice(0, Math.max(1, rule.maxAttempts));
    if (ordered.length === 0) {
      if (idemScope) {
        inflight.delete(idemScope);
      }
      c.header("Retry-After", "5");
      return c.json(errorBody("No healthy providers available", "provider_error", "no_healthy_providers"), 503);
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
      if (req.cache_ttl) {
        const key = cacheKey(auth.orgId, modelId, req.messages, req.max_tokens, req.temperature);
        const hit = await cacheGet(deps.redis, key);
        if (hit) {
          const latencyMs = Date.now() - started;
          await deps.usage.insert({
            idempotencyKey: req.idempotency_key ?? null,
            orgId: auth.orgId,
            keyId: auth.keyId,
            providerId: hit.providerId,
            model: modelId,
            inputTokens: hit.inputTokens,
            outputTokens: hit.outputTokens,
            latencyMs,
            costUsd: 0,
            status: "ok",
            error: null,
          });
          c.header("x-infergate-provider", hit.providerId);
          c.header("x-infergate-retry", "0");
          c.header("x-infergate-cache", "HIT");
          return c.json({
            id: `chatcmpl-${crypto.randomUUID().slice(0, 12)}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{ index: 0, message: { role: "assistant", content: hit.text }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: hit.inputTokens,
              completion_tokens: hit.outputTokens,
              total_tokens: hit.inputTokens + hit.outputTokens,
            },
          });
        }
        c.header("x-infergate-cache", "MISS");
      }
      const controller = new AbortController();
      const onClientAbort = () => controller.abort();
      c.req.raw.signal.addEventListener("abort", onClientAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), deps.config.streamMaxDurationMs);
      let begun: { id: string } | null = null;
      try {
        const startedRow = await deps.usage.begin({
          idempotencyKey: req.idempotency_key ?? null,
          orgId: auth.orgId,
          keyId: auth.keyId,
          providerId: ordered[0].providerId,
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          costUsd: 0,
        }).catch(() => null);
        if (!startedRow) {
          return c.json(errorBody("Usage unavailable", "provider_error", "usage_unavailable"), 503);
        }
        if (startedRow.replayed) {
          const prior = startedRow.row;
          const adoptable = prior.status === "started" && Date.now() - prior.createdAt > 300000;
          if (!adoptable) {
            return c.json(errorBody("Duplicate request", "invalid_request_error", "idempotent_replay"), 409);
          }
        }
        begun = { id: startedRow.row.id };
        if (idemScope) {
          inflight.add(idemScope);
        }
      } catch {
        return c.json(errorBody("Usage unavailable", "provider_error", "usage_unavailable"), 503);
      }
      let attempts = 0;
      let lastAttempted = ordered[0].providerId;
      try {
        for (const cand of ordered) {
          attempts += 1;
          const adapter = deps.registry.get(cand.providerId);
          if (!adapter) {
            continue;
          }
          lastAttempted = adapter.id;
          span.setAttribute("provider", adapter.id);
          const effectiveModel = req.model === "auto" ? (AUTO_MODELS[adapter.id] ?? modelId) : modelId;
          const attemptStarted = Date.now();
          const attempt = withAttemptTimeout(controller.signal, deps.config.attemptTimeoutMs);
          try {
            const result = await adapter.chatCompletion({ ...internal, model: effectiveModel }, attempt.signal);
            const latencyMs = Date.now() - started;
            deps.routing.reportSuccess(adapter.id, Date.now() - attemptStarted);
            if (begun) {
              await deps.usage.finish(begun.id, {
                providerId: result.providerId,
                model: effectiveModel,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                latencyMs,
                costUsd: result.usage.costUsd,
                status: "ok",
                error: null,
              }).catch(() => undefined);
            }
            observeRequest(result.providerId, effectiveModel, latencyMs, result.usage.inputTokens, result.usage.outputTokens, result.usage.costUsd);
            if (req.cache_ttl) {
              const entry: CachedCompletion = {
                text: result.text,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                costUsd: result.usage.costUsd,
                providerId: result.providerId,
                modelId: effectiveModel,
              };
              await cacheSet(deps.redis, cacheKey(auth.orgId, effectiveModel, req.messages, req.max_tokens, req.temperature), entry, req.cache_ttl);
            }
            const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
            c.header("x-infergate-provider", result.providerId);
            c.header("x-infergate-retry", String(attempts - 1));
            return c.json({
              id: completionId,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: effectiveModel,
              choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
              usage: {
                prompt_tokens: result.usage.inputTokens,
                completion_tokens: result.usage.outputTokens,
                total_tokens: result.usage.inputTokens + result.usage.outputTokens,
              },
            });
          } catch (err) {
            attempt.cancel();
            const message = err instanceof Error ? err.message : "provider_failure";
            if (message === "aborted") {
              throw err;
            }
            failWithOutage(adapter.id);
            observeProviderError(adapter.id);
            if (attempts < ordered.length) {
              await sleep(deps.routing.backoffFor(attempts - 1), controller.signal).catch(() => undefined);
              if (controller.signal.aborted) {
                throw new Error("aborted");
              }
            }
            continue;
          }
          attempt.cancel();
        }
        if (begun) {
          await deps.usage.finish(begun.id, {
            providerId: lastAttempted,
            model: modelId,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - started,
            costUsd: 0,
            status: "error",
            error: "provider_unavailable",
          }).catch(() => undefined);
        }
        return c.json(errorBody("Provider unavailable", "provider_error", "provider_unavailable"), 502);
      } catch (err) {
        const message = err instanceof Error ? err.message : "provider_failure";
        if (message === "aborted") {
          if (begun) {
            await deps.usage.finish(begun.id, {
              providerId: lastAttempted,
              model: modelId,
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: Date.now() - started,
              costUsd: 0,
              status: "error",
              error: "provider_timeout",
            }).catch(() => undefined);
          }
          return c.json(errorBody("Request timed out", "provider_error", "provider_timeout"), 504);
        }
        return c.json(errorBody("Provider unavailable", "provider_error", "provider_unavailable"), 502);
      } finally {
        clearTimeout(timeout);
        c.req.raw.signal.removeEventListener("abort", onClientAbort);
        if (idemScope) {
          inflight.delete(idemScope);
        }
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
    let winner = ordered[0].providerId;
    let lastStreamAttempt = "unknown";
    let retries = 0;
    let budgetExceeded = false;
    const quota = c.get("quota") as AppEnv["Variables"]["quota"] | undefined;
    const inputEst = Math.ceil(internal.messages.reduce((n, m) => n + m.content.length, 0) / 4);
    let outEst = 0;
    let clientGone = false;
    const onStreamClientAbort = () => {
      clientGone = true;
      streamController.abort();
    };
    c.req.raw.signal.addEventListener("abort", onStreamClientAbort, { once: true });

    const streamBegun = await deps.usage.begin({
      idempotencyKey: req.idempotency_key ?? null,
      orgId: auth.orgId,
      keyId: auth.keyId,
      providerId: ordered[0].providerId,
      model: modelId,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costUsd: 0,
    }).catch(() => null);
    if (streamBegun && streamBegun.replayed) {
      const prior = streamBegun.row;
      const adoptable = prior.status === "started" && Date.now() - prior.createdAt > 300000;
      if (!adoptable) {
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        return c.json(errorBody("Duplicate request", "invalid_request_error", "idempotent_replay"), 409);
      }
    }
    if (idemScope && streamBegun) {
      inflight.add(idemScope);
    }

    return streamSSE(c, async (stream) => {
      const api = stream as unknown as { onAbort?: (fn: () => void) => void };
      if (typeof api.onAbort === "function") {
        api.onAbort(onStreamClientAbort);
      }
      let active: ProviderAdapter | null = null;
      let iterator: AsyncGenerator<{ delta: string; done: boolean; usage?: { inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number } }> | null = null;
      let established = false;
      let streamModel = modelId;
      try {
        for (let i = 0; i < ordered.length; i += 1) {
          const cand = ordered[i];
          const adapter = deps.registry.get(cand.providerId);
          if (!adapter) {
            continue;
          }
          lastStreamAttempt = adapter.id;
          if (i > 0) {
            await sleep(deps.routing.backoffFor(i - 1), streamController.signal).catch(() => undefined);
            if (streamController.signal.aborted) {
              throw new Error("aborted");
            }
          }
          const streamInternal = {
            ...internal,
            model: req.model === "auto" ? (AUTO_MODELS[adapter.id] ?? modelId) : modelId,
          };
          const gen = adapter.streamCompletion(streamInternal, streamController.signal);
          try {
            const first = await gen.next();
            if (first.done) {
              failWithOutage(adapter.id);
              continue;
            }
            active = adapter;
            winner = adapter.id;
            retries = i;
            streamModel = streamInternal.model;
            span.setAttribute("provider", adapter.id);
            span.setAttribute("model", streamModel);
            iterator = (async function* () {
              yield first.value;
              yield* gen;
            })();
            established = true;
            break;
          } catch (err) {
            const message = err instanceof Error ? err.message : "provider_failure";
            if (message === "aborted") {
              throw err;
            }
            failWithOutage(adapter.id);
            observeProviderError(adapter.id);
          }
        }
        if (!established || !iterator || !active) {
          await stream.writeSSE({
            data: JSON.stringify({ error: { message: "Provider unavailable", type: "provider_error" } }),
          });
          winner = lastStreamAttempt;
          return;
        }
        await stream.writeSSE({
          event: "infergate.route",
          data: JSON.stringify({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: streamModel,
            choices: [{ index: 0, delta: {}, finish_reason: null }],
            infergate: { provider: winner, retry: retries, model: streamModel },
          }),
        });
        const attemptStarted = Date.now();
        let interrupted = false;
        for await (const chunk of iterator) {
          if (stream.aborted || clientGone) {
            interrupted = true;
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
                model: streamModel,
                choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null }],
              }),
            });
            outEst += Math.ceil(chunk.delta.length / 4);
            if (quota && inputEst + outEst > quota.remainingTokens) {
              budgetExceeded = true;
              streamController.abort();
              break;
            }
          }
        }
        if (budgetExceeded) {
          await stream.writeSSE({
            data: JSON.stringify({ error: { message: "Quota exceeded", type: "quota_error", code: "quota_exceeded" } }),
          });
        } else if (!interrupted && !streamController.signal.aborted) {
          await stream.writeSSE({ data: "[DONE]" });
          settled = true;
          if (active) {
            deps.routing.reportSuccess(active.id, Date.now() - attemptStarted);
          }
        } else if (interrupted && !clientGone && active) {
          failWithOutage(active.id);
          observeProviderError(active.id);
        }
      } catch {
        observeProviderError(established ? winner : lastStreamAttempt);
        await stream.writeSSE({
          data: JSON.stringify({ error: { message: "Provider unavailable", type: "provider_error" } }),
        }).catch(() => undefined);
      } finally {
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        c.req.raw.signal.removeEventListener("abort", onStreamClientAbort);
        if (idemScope) {
          inflight.delete(idemScope);
        }
        const latencyMs = Date.now() - startedAt;
        if (budgetExceeded) {
          accInput = Math.max(accInput, inputEst);
          accOutput = Math.max(accOutput, outEst);
          deps.notify.emit(deps.webhooks, auth.orgId, "quota.exceeded", {
            tokens: accInput + accOutput,
            stream: true,
          });
        }
        const patch = {
          providerId: established ? winner : lastStreamAttempt,
          model: established ? streamModel : modelId,
          inputTokens: accInput,
          outputTokens: accOutput,
          latencyMs,
          costUsd: accCost,
          status: settled ? "ok" : "error",
          error: settled ? null : budgetExceeded ? "quota_exceeded" : "stream_interrupted",
        };
        if (streamBegun) {
          await deps.usage.finish(streamBegun.row.id, patch).catch(() => undefined);
        } else {
          await deps.usage
            .insert({
              idempotencyKey: req.idempotency_key ?? null,
              orgId: auth.orgId,
              keyId: auth.keyId,
              ...patch,
            })
            .catch(() => undefined);
        }
        observeRequest(established ? winner : lastStreamAttempt, established ? streamModel : modelId, latencyMs, accInput, accOutput, accCost);
        span.end();
      }
    });
  });

  return app;
}
