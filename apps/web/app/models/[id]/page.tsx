"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { KeyGate } from "../../../components/KeyGate";
import { getKey } from "../../../lib/api";
import { GATEWAY_URL } from "../../../lib/api";

interface Detail {
  id: string;
  owned_by: string;
  provider: string;
  pricing: { input_per_1k: number; output_per_1k: number };
  context_window: number;
}

export default function ModelDetail({ params }: { params: Promise<{ id: string }> }): React.ReactElement {
  const { id } = use(params);
  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
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
    fetch(`${GATEWAY_URL}/v1/models/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${getKey()}` } })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error();
        }
        setDetail(await r.json());
      })
      .catch(() => setError("Model not found or key lacks models:read."));
  }, [ready, id]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <Link href="/models" className="font-mono text-xs text-fog hover:text-white">
        ← catalog
      </Link>
      {error !== "" && (
        <div className="mt-4 rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">{error}</div>
      )}
      {detail && (
        <div>
          <h1 className="mt-2 font-mono text-3xl font-extrabold tracking-tight">{detail.id}</h1>
          <p className="mb-8 mt-1.5 font-mono text-sm text-fog">
            {detail.owned_by} · served by {detail.provider}
          </p>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
              <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Input / 1k</div>
              <div className="font-mono text-[28px] font-extrabold">${detail.pricing.input_per_1k}</div>
            </div>
            <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
              <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Output / 1k</div>
              <div className="font-mono text-[28px] font-extrabold">${detail.pricing.output_per_1k}</div>
            </div>
            <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
              <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Context</div>
              <div className="font-mono text-[28px] font-extrabold">{detail.context_window.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
              <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Try it</div>
              <Link
                href={`/playground?model=${encodeURIComponent(detail.id)}`}
                className="inline-block rounded-xl border border-acid bg-acid px-4 py-2 text-sm font-bold text-black"
              >
                Playground
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
