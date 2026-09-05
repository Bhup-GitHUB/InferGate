"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "@/components/KeyGate";
import { getKey, listModels, type ModelEntry } from "@/lib/api";

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
    <div>
      <h1 className="page-title">Model catalog</h1>
      <p className="page-sub">One endpoint, every engine. Pick by alias — routing handles the rest.</p>
      <div className="grid-4">
        {models.map((m) => (
          <div key={m.id} className="card">
            <div className="card-title mono">{m.owned_by}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }} className="mono">
              {m.id}
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>{PRICES[m.id] ?? "metered"}</p>
            <span className="pill">
              <span className="dot dot-ok" />
              available
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
