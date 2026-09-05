"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyGate } from "@/components/KeyGate";
import { fetchBilling, fetchDaily, fetchRoutingHealth, fetchUsage, getKey } from "@/lib/api";

interface Daily {
  date: string;
  requests: number;
  costUsd: number;
}

function maxOf(days: Daily[]): number {
  return Math.max(1, ...days.map((d) => d.requests));
}

export default function Overview(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [usage, setUsage] = useState({ requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  const [billing, setBilling] = useState<{ plan: string; spendUsd: number; quotaUsd: number } | null>(null);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [providers, setProviders] = useState<{ id: string; circuit: string; ewmaLatencyMs: number; errorRate: number }[]>([]);
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

  const peak = maxOf(daily);

  return (
    <div>
      <h1 className="page-title">Good evening, builder.</h1>
      <p className="page-sub">Live traffic across every provider behind one OpenAI-compatible endpoint.</p>
      {error !== "" && (
        <div className="card" style={{ borderColor: "#4a2323", marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div className="grid-4">
        <div className="card">
          <div className="card-title">Requests</div>
          <div className="stat-value mono">{usage.requests.toLocaleString()}</div>
          <div className="stat-delta">all-time served</div>
        </div>
        <div className="card">
          <div className="card-title">Tokens</div>
          <div className="stat-value mono">{(usage.inputTokens + usage.outputTokens).toLocaleString()}</div>
          <div className="stat-delta">
            {(usage.inputTokens / 1000).toFixed(1)}k in / {(usage.outputTokens / 1000).toFixed(1)}k out
          </div>
        </div>
        <div className="card">
          <div className="card-title">Spend</div>
          <div className="stat-value mono">${usage.costUsd.toFixed(4)}</div>
          <div className="stat-delta">
            {billing ? `${billing.plan} plan / $${billing.quotaUsd} cap` : "/quota unknown"}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Providers online</div>
          <div className="stat-value mono">
            {providers.filter((p) => p.circuit === "closed").length}/{providers.length}
          </div>
          <div className="stat-delta">circuits closed</div>
        </div>
      </div>
      <div className="grid-2 section">
        <div className="card">
          <div className="row-between">
            <div className="card-title">Requests · last 14 days</div>
            <button className="btn" onClick={load}>
              Refresh
            </button>
          </div>
          <div className="bar-row">
            {daily.map((d) => (
              <div
                key={d.date}
                className="bar"
                data-tip={`${d.date}: ${d.requests} req / $${d.costUsd.toFixed(4)}`}
                style={{ height: `${Math.max(3, (d.requests / peak) * 100)}%`, opacity: d.requests === 0 ? 0.25 : 1 }}
              />
            ))}
          </div>
          <div className="bar-axis">
            {daily.map((d) => (
              <span key={d.date} className="mono">
                {d.date.slice(5)}
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Provider health</div>
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Circuit</th>
                <th>EWMA</th>
                <th>Err</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td>
                    <span className="pill">
                      <span className={p.circuit === "closed" ? "dot dot-ok" : p.circuit === "half-open" ? "dot dot-warn" : "dot dot-bad"} />
                      {p.circuit}
                    </span>
                  </td>
                  <td className="mono">{p.ewmaLatencyMs}ms</td>
                  <td className="mono">{(p.errorRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
