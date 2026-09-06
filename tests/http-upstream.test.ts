import { describe, expect, test } from "bun:test";
import { createRegistryFromEnv } from "@infergate/providers";

function openaiUpstream(): Bun.Server {
  return Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) {
        return Response.json({ data: [] });
      }
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"hello "}}]}\n\n`));
          controller.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"world"}}]}\n\n`));
          controller.enqueue(enc.encode(`data: {"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n`));
          controller.enqueue(enc.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
}

function anthropicUpstream(): Bun.Server {
  return Bun.serve({
    port: 0,
    fetch: () => {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(`event: message_start\ndata: {"message":{"usage":{"input_tokens":9}}}\n\n`));
          controller.enqueue(enc.encode(`event: content_block_delta\ndata: {"delta":{"text":"hi "}}\n\n`));
          controller.enqueue(enc.encode(`event: content_block_delta\ndata: {"delta":{"text":"there"}}\n\n`));
          controller.enqueue(enc.encode(`event: message_delta\ndata: {"usage":{"output_tokens":4}}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
}

describe("live adapters against stub upstreams", () => {
  test("openai sse usage is captured", async () => {
    const upstream = openaiUpstream();
    const { registry, live } = createRegistryFromEnv({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: `http://localhost:${upstream.port}`,
    });
    expect(live).toEqual(["openai"]);
    const adapter = registry.get("openai");
    expect(adapter).toBeDefined();
    const chunks = [];
    for await (const c of adapter!.streamCompletion(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], orgId: "o" },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.usage?.inputTokens).toBe(7);
    expect(last.usage?.outputTokens).toBe(3);
    const text = chunks.filter((c) => !c.done).map((c) => c.delta).join("");
    expect(text).toBe("hello world");
    upstream.stop(true);
  });

  test("anthropic sse usage is captured", async () => {
    const upstream = anthropicUpstream();
    const { registry, live } = createRegistryFromEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_BASE_URL: `http://localhost:${upstream.port}`,
    });
    expect(live).toEqual(["anthropic"]);
    const adapter = registry.get("anthropic");
    const chunks = [];
    for await (const c of adapter!.streamCompletion(
      { model: "claude-3-haiku", messages: [{ role: "user", content: "hi" }], orgId: "o" },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const last = chunks[chunks.length - 1];
    expect(last.usage?.inputTokens).toBe(9);
    expect(last.usage?.outputTokens).toBe(4);
    upstream.stop(true);
  });
});
