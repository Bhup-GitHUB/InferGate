import OpenAI from "openai";

const BASE = process.env["GATEWAY_URL"] ?? "http://localhost:3000";
const KEY = process.env["GATEWAY_KEY"] ?? "";

if (KEY === "") {
  console.error("GATEWAY_KEY is required");
  process.exit(1);
}

const client = new OpenAI({ baseURL: `${BASE}/v1`, apiKey: KEY });

const models = await client.models.list();
console.log(JSON.stringify({ models: models.data.map((m) => m.id) }));

const completion = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Say the word HELLO and nothing else" }],
});
console.log(JSON.stringify({ reply: completion.choices[0]?.message?.content?.slice(0, 80), model: completion.model }));

const stream = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Count to five" }],
  stream: true,
});
let chunks = 0;
let text = "";
for await (const part of stream) {
  const delta = part.choices[0]?.delta?.content ?? "";
  if (delta !== "") {
    chunks += 1;
    text += delta;
  }
}
console.log(JSON.stringify({ chunks, chars: text.length, done: true }));

export {};
