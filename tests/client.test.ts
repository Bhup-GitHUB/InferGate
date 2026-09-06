import { describe, expect, test } from "bun:test";
import { generateKey } from "@infergate/auth";
import { InferGate, InferGateError } from "@infergate/client";
import { createApp } from "../apps/gateway/src/app";

const PEPPER = "client-test-pepper-01";

async function setup() {
  const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
  const g = generateKey("org_client", ["chat:write", "models:read", "usage:read"], PEPPER, 1);
  await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });
  const server = Bun.serve({ port: 0, fetch: handles.app.fetch });
  return { client: new InferGate({ baseUrl: `http://localhost:${server.port}`, apiKey: g.publicKey }), server };
}

describe("client sdk", () => {
  test("models, chat, stream, usage", async () => {
    const { client, server } = await setup();
    const models = await client.models();
    expect(models.length).toBeGreaterThan(0);
    const completion = await client.chat({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });
    expect(completion.content.length).toBeGreaterThan(0);
    expect(completion.provider).toBe("openai");
    let chars = 0;
    for await (const token of client.stream({ model: "auto", messages: [{ role: "user", content: "hi" }] })) {
      chars += token.length;
    }
    expect(chars).toBeGreaterThan(0);
    const usage = await client.usage();
    expect(usage.requests).toBe(2);
    server.stop(true);
  });

  test("errors carry status and code", async () => {
    const { client, server } = await setup();
    try {
      await client.chat({ model: "nope-9000", messages: [{ role: "user", content: "hi" }] });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(InferGateError);
      expect((err as InferGateError).status).toBe(400);
    }
    server.stop(true);
  });
});
