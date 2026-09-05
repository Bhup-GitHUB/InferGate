"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { fetchPlacementDemo, getKey } from "../../lib/api";

interface Demo {
  placements: { modelId: string; nodeId: string }[];
  utilization: { nodeId: string; usedMemGb: number; totalMemGb: number }[];
}

export default function Fleet(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState<Demo | null>(null);

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      fetchPlacementDemo(getKey())
        .then(setDemo)
        .catch(() => undefined);
    }
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">GPU Fleet</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Where models would land on a two-node A100 + H100 fleet.</p>
      {demo && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
            <div className="mb-2 text-xs uppercase tracking-[0.12em] text-fog">Placements</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">Model</th>
                  <th className="border-b border-edge px-3 py-2.5 text-left text-[11px] uppercase tracking-[0.1em] text-fog">Node</th>
                </tr>
              </thead>
              <tbody>
                {demo.placements.map((p, i) => (
                  <tr key={i}>
                    <td className="border-b border-[#141418] px-3 py-3 font-mono">{p.modelId}</td>
                    <td className="border-b border-[#141418] px-3 py-3 font-mono">{p.nodeId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
            <div className="mb-2 text-xs uppercase tracking-[0.12em] text-fog">Memory utilization</div>
            {demo.utilization.map((u) => {
              const pct = u.totalMemGb === 0 ? 0 : Math.round((u.usedMemGb / u.totalMemGb) * 100);
              return (
                <div key={u.nodeId} className="mb-4">
                  <div className="mb-1.5 flex justify-between font-mono text-sm">
                    <span>{u.nodeId}</span>
                    <span className="text-fog">
                      {u.usedMemGb}/{u.totalMemGb} GB · {pct}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-md bg-[#15151a]">
                    <div className="h-full bg-gradient-to-r from-grape to-ice" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
