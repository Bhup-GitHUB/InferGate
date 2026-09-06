"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { getKey } from "../../lib/api";
import { GATEWAY_URL } from "../../lib/api";

interface Entry {
  id: string;
  action: string;
  target: string | null;
  created_at?: string;
  createdAt?: number;
}

export default function Audit(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    fetch(`${GATEWAY_URL}/v1/audit?limit=50`, { headers: { authorization: `Bearer ${getKey()}` } })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error();
        }
        const body = await r.json();
        setEntries(body.data);
      })
      .catch(() => setError("Audit needs keys:write scope."));
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Audit log</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Key, plan, webhook, and routing changes in this organization.</p>
      {error !== "" && (
        <div className="mb-4 rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">{error}</div>
      )}
      <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Action", "Target", "At"].map((h) => (
                <th key={h} className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="border-b border-[#141418] px-3 py-3 font-mono">{e.action}</td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono text-xs">{e.target ?? "—"}</td>
                <td className="border-b border-[#141418] px-3 py-3 font-mono text-xs tabular-nums">
                  {typeof e.createdAt === "number" ? new Date(e.createdAt).toLocaleString() : (e.created_at ?? "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="py-6 text-center text-sm text-fog">No admin actions yet.</p>}
      </div>
    </div>
  );
}
