import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { errorBody } from "@infergate/schemas";
import type { AppEnv, AuthContext } from "../../lib/env";
import type { UsageStore } from "../../lib/store";
import { requireScope } from "../../middleware/auth";

const embeddingSchema = z.object({
  model: z.string().min(1).max(128),
  input: z.union([z.string().min(1).max(32000), z.array(z.string().min(1).max(8000)).min(1).max(64)]),
});

function embed(text: string, dimensions: number): number[] {
  const out: number[] = [];
  let seed = createHash("sha256").update(text).digest();
  while (out.length < dimensions) {
    for (const byte of seed) {
      if (out.length >= dimensions) {
        break;
      }
      out.push(Math.round(((byte / 255) * 2 - 1) * 1e6) / 1e6);
    }
    seed = createHash("sha256").update(seed).digest();
  }
  return out;
}

export function embeddingRoutes(deps: { usage: UsageStore }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/embeddings", async (c) => {
    if (!requireScope(c, "chat:write")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    const auth = c.get("auth") as AuthContext;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const parsed = embeddingSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(errorBody("Invalid embedding request", "invalid_request_error", "validation_error"), 400);
    }
    const inputs = Array.isArray(parsed.data.input) ? parsed.data.input : [parsed.data.input];
    const data = inputs.map((text, index) => ({
      object: "embedding" as const,
      index,
      embedding: embed(`${parsed.data.model}:${text}`, 64),
    }));
    const promptTokens = Math.ceil(inputs.join(" ").length / 4);
    await deps.usage.insert({
      idempotencyKey: null,
      orgId: auth.orgId,
      keyId: auth.keyId,
      providerId: "local-embed",
      model: parsed.data.model,
      inputTokens: promptTokens,
      outputTokens: 0,
      latencyMs: 0,
      costUsd: 0,
      status: "ok",
      error: null,
      region: "home",
    }).catch(() => undefined);
    return c.json({
      object: "list",
      data,
      model: parsed.data.model,
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    });
  });

  return app;
}
