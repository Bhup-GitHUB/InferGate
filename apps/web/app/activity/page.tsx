"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { fetchRecent, getKey } from "../../lib/api";

interface Row {
  id: string;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_usd: number;
  status: string;
  created_at: string;
}

export default function Activity(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      fetchRecent(getKey(), 50)
        .then((r) => setRows(r.data))
        .catch(() => undefined);
    }
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Activity</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Every request this organization served, newest first.</p>
      <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Time", "Model", "Provider", "Tokens", "Latency", "Cost", "Status"].map((h) => (
                <th key={h} className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="border-b border-[#141418] px-3 py-3 font-mono text-xs tabular-nums">
                  {r.created_at.slice(11, 19)}
                </td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono">{r.model}</td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono">{r.provider ?? "—"}</td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono tabular-nums">
                  {(r.input_tokens + r.output_tokens).toLocaleString()}
                </td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono tabular-nums">{r.latency_ms}ms</td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono tabular-nums">${r.cost_usd.toFixed(5)}</td>
                <td className="border-b border-[#141418] px-3 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-[#131318] px-3 py-1 text-xs font-semibold">
                    <span
                      className={
                        r.status === "ok"
                          ? "h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_#c8ff2e]"
                          : "h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_#f87171]"
                      }
                    />
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-fog">No requests yet. Hit the playground.</p>}
      </div>
    </div>
  );
}
