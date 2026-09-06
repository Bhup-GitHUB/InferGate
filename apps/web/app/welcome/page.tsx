import Link from "next/link";

const FEATURES = [
  { title: "One endpoint", body: "OpenAI-compatible chat, streaming, embeddings, and models across every provider." },
  { title: "Smart routing", body: "Cost, latency, availability, weighted, and priority strategies with breakers and failover." },
  { title: "Quotas + billing", body: "Plans, 402 enforcement, stream budgets, daily rollups, invoice drafts." },
  { title: "Webhooks", body: "HMAC-signed quota and outage alerts with retries and delivery logs." },
  { title: "Live providers", body: "Mocks by default, real OpenAI and Anthropic behind env keys. The real SDK works." },
  { title: "Zero-trust keys", body: "HMAC + salt + pepper, rotation grace, no-escalation minting, cached off the hot path." },
];

export default function Welcome(): React.ReactElement {
  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-16 lg:px-12">
      <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-panel px-4 py-1.5 text-xs font-semibold text-fog">
        <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_#c8ff2e]" />
        PRODUCTION AI GATEWAY · OPENAI-COMPATIBLE
      </div>
      <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[1.05] tracking-tight lg:text-7xl">
        Every model.
        <br />
        <span className="bg-gradient-to-r from-acid to-ice bg-clip-text text-transparent">One endpoint.</span>
      </h1>
      <p className="mt-6 max-w-xl text-base leading-relaxed text-fog">
        InferGate routes, meters, and bills inference across providers with
        circuit breakers, quotas, webhooks, and a live console — verified with
        the real OpenAI SDK.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-xl border border-acid bg-acid px-6 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(200,255,46,0.35)] transition hover:-translate-y-px"
        >
          Open console
        </Link>
        <Link
          href="/playground"
          className="rounded-xl border border-edge bg-panel2 px-6 py-3 text-sm font-semibold transition hover:-translate-y-px hover:border-[#3a3a44]"
        >
          Try playground
        </Link>
      </div>
      <div className="mt-10 rounded-2xl border border-edge bg-[#08080a] p-5 font-mono text-[13px] leading-relaxed">
        <div className="text-fog"># point any OpenAI client at InferGate</div>
        <div>
          <span className="text-grape">export</span> GATEWAY_URL=http://localhost:3000
        </div>
        <div>
          <span className="text-grape">curl</span> $GATEWAY_URL/v1/chat/completions \
        </div>
        <div className="pl-4">-H <span className="text-acid">"authorization: Bearer $KEY"</span> \</div>
        <div className="pl-4">-d <span className="text-acid">{'{"model":"auto","messages":[{"role":"user","content":"hi"}]}'}</span></div>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
            <div className="text-base font-extrabold">{f.title}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-fog">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
