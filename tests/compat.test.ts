import { afterAll, describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { generateKey } from "@infergate/auth";
import { createApp } from "../apps/gateway/src/app";

const PEPPER = "compat-suite-pepper-01";

const handles = createApp({ API_KEY_PEPPER: PEPPER, PEPPER_VERSION: "1", RATE_LIMIT_PER_MINUTE: "1000" });
const g = generateKey("org_compat", ["chat:write", "models:read"], PEPPER, 1);
await handles.keys.save({ id: crypto.randomUUID(), createdAt: Date.now(), ...g.record });

const server = Bun.serve({ port: 0, fetch: handles.app.fetch });
const client = new OpenAI({ baseURL: `http://localhost:${server.port}/v1`, apiKey: g.publicKey });

afterAll(() => {
  server.stop(true);
});

describe("openai sdk compat", () => {
  test("models list", async () => {
    const models = await client.models.list();
    expect(models.data.length).toBeGreaterThan(0);
  });

  test("chat completion", async () => {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(completion.choices[0]?.message?.content?.length).toBeGreaterThan(0);
    expect(completion.usage?.total_tokens).toBeGreaterThan(0);
  });

  test("streaming completion", async () => {
    const stream = await client.chat.completions.create({
      model: "auto",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    let chars = 0;
    for await (const part of stream) {
      chars += part.choices[0]?.delta?.content?.length ?? 0;
    }
    expect(chars).toBeGreaterThan(0);
  });
});
