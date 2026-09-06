"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyGate } from "../components/KeyGate";
import { fetchBilling, fetchDaily, fetchRoutingHealth, fetchUsage, getKey } from "../lib/api";

interface Daily {
  date: string;
  requests: number;
  costUsd: number;
}

export default function Overview(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [usage, setUsage] = useState({ requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  const [billing, setBilling] = useState<{ plan: string; quotaUsd: number } | null>(null);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [providers, setProviders] = useState<{ id: string; circuit: string; kind: string; ewmaLatencyMs: number; errorRate: number }[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const key = getKey();
    if (key === "") {
      return;
    }
    try {
      const [u, b, d, r] = await Promise.all([
        fetchUsage(key),
        fetchBilling(key).catch(() => null),
        fetchDaily(key, 14),
        fetchRoutingHealth(key),
      ]);
      setUsage(u);
      setBilling(b);
      setDaily(d.days);
      setProviders(r.providers);
      setError("");
    } catch {
      setError("Gateway unreachable or key invalid. Check the key and gateway URL.");
    }
  }, []);

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      load();
      const timer = setInterval(load, 5000);
      return () => clearInterval(timer);
    }
  }, [ready, load]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  const peak = Math.max(1, ...daily.map((d) => d.requests));
  const stats = [
    { label: "Requests", value: usage.requests.toLocaleString(), sub: "all-time served" },
    {
      label: "Tokens",
      value: (usage.inputTokens + usage.outputTokens).toLocaleString(),
      sub: `${(usage.inputTokens / 1000).toFixed(1)}k in / ${(usage.outputTokens / 1000).toFixed(1)}k out`,
    },
    {
      label: "Spend",
      value: `$${usage.costUsd.toFixed(4)}`,
      sub: billing ? `${billing.plan} plan / $${billing.quotaUsd} cap` : "quota unknown",
    },
    {
      label: "Providers online",
      value: `${providers.filter((p) => p.circuit === "closed").length}/${providers.length}`,
      sub: "circuits closed",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Good evening, builder.</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Live traffic across every provider behind one OpenAI-compatible endpoint.</p>
      {error !== "" && <div className="mb-4 rounded-2xl border border-[#4a2323] bg-panel p-5">{error}</div>}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
            <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">{s.label}</div>
            <div className="font-mono text-[32px] font-extrabold tracking-tight">{s.value}</div>
            <div className="mt-1.5 text-xs text-acid">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.12em] text-fog">Requests · last 14 days</div>
            <button
              className="rounded-xl border border-edge bg-panel2 px-4 py-2 text-sm font-semibold transition hover:-translate-y-px hover:border-[#3a3a44]"
              onClick={load}
            >
              Refresh
            </button>
          </div>
          <div className="mt-3 flex h-[150px] items-end gap-1.5">
            {daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.requests} req / $${d.costUsd.toFixed(4)}`}
                className="min-h-[4px] flex-1 rounded-t-md bg-gradient-to-t from-acid/25 to-acid"
                style={{ height: `${Math.max(3, (d.requests / peak) * 100)}%`, opacity: d.requests === 0 ? 0.25 : 1 }}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {daily.map((d) => (
              <span key={d.date} className="flex-1 text-center font-mono text-[10px] text-fog">
                {d.date.slice(5)}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
          <div className="mb-2 text-xs uppercase tracking-[0.12em] text-fog">Provider health</div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">Provider</th>
                <th className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">Circuit</th>
                <th className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">EWMA</th>
                <th className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">Err</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td className="border-b border-[#141418] px-3 py-3 font-mono tabular-nums">
                    {p.id}{" "}
                    <span className={p.kind === "live" ? "text-acid" : "text-fog"}>· {p.kind}</span>
                  </td>
                  <td className="border-b border-[#141418] px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-[#131318] px-3 py-1 text-xs font-semibold">
                      <span
                        className={
                          p.circuit === "closed"
                            ? "h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_#c8ff2e]"
                            : p.circuit === "half-open"
                              ? "h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]"
                              : "h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_#f87171]"
                        }
                      />
                      {p.circuit}
                    </span>
                  </td>
                  <td className="border-b border-[#141418] px-3 py-3 font-mono tabular-nums">{p.ewmaLatencyMs}ms</td>
                  <td className="border-b border-[#141418] px-3 py-3 font-mono tabular-nums">{(p.errorRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
