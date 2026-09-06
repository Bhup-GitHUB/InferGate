"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { getKey, listModels, type ModelEntry } from "../../lib/api";

const PRICES: Record<string, string> = {
  "gpt-4o-mini": "$0.50 / $1.50 per 1M",
  "gpt-4o": "$5.00 / $15.00 per 1M",
  "claude-3-5-sonnet": "$3.00 / $15.00 per 1M",
  "claude-3-haiku": "$0.80 / $2.40 per 1M",
  "llama-3-8b": "$0.10 / $0.20 per 1M",
  "mistral-7b": "$0.10 / $0.20 per 1M",
  auto: "cheapest healthy route",
};

export default function Models(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      listModels(getKey())
        .then(setModels)
        .catch(() => undefined);
    }
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Model catalog</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">One endpoint, every engine. Pick by alias — routing handles the rest.</p>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {models.map((m) => (
          <Link key={m.id} href={`/models/${m.id}`} className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5 transition hover:-translate-y-0.5 hover:border-[#3a3a44]">
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.12em] text-fog">{m.owned_by}</div>
            <div className="font-mono text-xl font-extrabold">{m.id}</div>
            <p className="text-[13px] text-fog">{PRICES[m.id] ?? "metered"}</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-edge bg-[#131318] px-3 py-1 text-xs font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_#c8ff2e]" />
              available
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
