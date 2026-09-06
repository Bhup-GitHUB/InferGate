"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { fetchBilling, getKey, setPlan } from "../../lib/api";

interface Summary {
  plan: string;
  period: string;
  tokensUsed: number;
  tokenQuota: number;
  spendUsd: number;
  quotaUsd: number;
  invoice: { amountUsd: number; status: string };
}

export default function Billing(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [planTick, setPlanTick] = useState(0);

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      fetchBilling(getKey())
        .then(setSummary)
        .catch(() => setError("Billing needs billing:read scope on this key."));
    }
  }, [ready, planTick]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  const pct = (a: number, b: number): number => (b <= 0 ? 0 : Math.min(100, Math.round((a / b) * 100)));

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Billing</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Spend, quotas, and the current invoice draft for this organization.</p>
      {error !== "" && (
        <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">{error}</div>
      )}
      {summary && (
        <div>
          <div className="bg-gradient-to-b from-white to-fog bg-clip-text font-mono text-[64px] font-black tracking-tight text-transparent">
            ${summary.spendUsd.toFixed(2)}
          </div>
          <p className="mb-8 mt-1.5 text-sm text-fog">
            {summary.period} · {summary.plan} plan · invoice {summary.invoice.status}
          </p>
          <div className="mb-4 flex gap-2">
            {["free", "pro", "enterprise"].map((p) => (
              <button
                key={p}
                className={
                  summary.plan === p
                    ? "rounded-xl border border-acid bg-acid px-4 py-2 text-sm font-bold text-black"
                    : "rounded-xl border border-edge bg-panel2 px-4 py-2 text-sm font-semibold transition hover:-translate-y-px"
                }
                onClick={async () => {
                  try {
                    await setPlan(getKey(), p);
                    setPlanTick((t) => t + 1);
                  } catch {
                    setError("Plan change needs admin:write scope.");
                  }
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
              <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">
                Token quota · {pct(summary.tokensUsed, summary.tokenQuota)}%
              </div>
              <div className="font-mono text-[32px] font-extrabold tracking-tight">{summary.tokensUsed.toLocaleString()}</div>
              <div className="mb-3 font-mono text-sm text-fog">of {summary.tokenQuota.toLocaleString()} tokens</div>
              <div className="h-2.5 overflow-hidden rounded-md bg-[#15151a]">
                <div className="h-full bg-acid" style={{ width: `${pct(summary.tokensUsed, summary.tokenQuota)}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
              <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">
                Spend quota · {pct(summary.spendUsd, summary.quotaUsd)}%
              </div>
              <div className="font-mono text-[32px] font-extrabold tracking-tight">${summary.spendUsd.toFixed(4)}</div>
              <div className="mb-3 font-mono text-sm text-fog">of ${summary.quotaUsd} cap</div>
              <div className="h-2.5 overflow-hidden rounded-md bg-[#15151a]">
                <div className="h-full bg-grape" style={{ width: `${pct(summary.spendUsd, summary.quotaUsd)}%` }} />
              </div>
              <div className="mt-4">
                <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Invoice draft</div>
                <div className="flex items-center justify-between">
                  <span className="font-mono">${summary.invoice.amountUsd.toFixed(4)}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-[#131318] px-3 py-1 text-xs font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                    {summary.invoice.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
