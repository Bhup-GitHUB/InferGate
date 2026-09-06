"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { getKey } from "../../lib/api";
import { GATEWAY_URL } from "../../lib/api";

interface Rule {
  orgId: string | null;
  modelAlias: string;
  strategy: string;
  weights: Record<string, number>;
  priority: string[];
  maxAttempts: number;
}

async function authed(key: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  });
}

export default function Routing(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [alias, setAlias] = useState("auto");
  const [strategy, setStrategy] = useState("availability");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      const res = await authed(getKey(), "/v1/routing/rules");
      if (!res.ok) {
        throw new Error();
      }
      const body = await res.json();
      setRules(body.data);
    } catch {
      setError("Rules need keys:write scope.");
    }
  }

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      refresh();
    }
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Routing</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Per-model strategies. Requests pick them up within 30 seconds.</p>
      <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">New rule</div>
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_auto]">
          <input
            className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="model alias (auto)"
          />
          <select
            className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
          >
            {["availability", "cost", "latency", "weighted", "priority"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            className="rounded-xl border border-acid bg-acid px-5 py-3 text-sm font-bold text-black transition hover:-translate-y-px"
            onClick={async () => {
              setError("");
              const res = await authed(getKey(), "/v1/routing/rules", {
                method: "POST",
                body: JSON.stringify({ modelAlias: alias.trim() || "auto", strategy }),
              });
              if (!res.ok) {
                setError("Creation failed.");
                return;
              }
              await refresh();
            }}
          >
            Save rule
          </button>
        </div>
        {error !== "" && <p className="text-[13px] text-red-400">{error}</p>}
      </div>
      <div className="mt-4 rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <div className="mb-2 text-xs uppercase tracking-[0.12em] text-fog">Active rules</div>
        {rules.map((r, i) => (
          <div key={i} className="flex items-center justify-between border-t border-edge py-3 text-sm first:border-t-0">
            <span className="font-mono">
              {r.modelAlias} → {r.strategy} <span className="text-fog">×{r.maxAttempts}</span>
            </span>
            <span className="font-mono text-xs text-fog">{r.orgId === null ? "global" : "org"}</span>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-fog">No custom rules. Default strategy applies.</p>}
      </div>
    </div>
  );
}
