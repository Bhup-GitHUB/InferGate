"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "@/components/KeyGate";
import { fetchBilling, getKey } from "@/lib/api";

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
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  const pct = (a: number, b: number): number => (b <= 0 ? 0 : Math.min(100, Math.round((a / b) * 100)));

  return (
    <div>
      <h1 className="page-title">Billing</h1>
      <p className="page-sub">Spend, quotas, and the current invoice draft for this organization.</p>
      {error !== "" && <div className="card">{error}</div>}
      {summary && (
        <div>
          <div className="hero-num mono">${summary.spendUsd.toFixed(2)}</div>
          <p className="page-sub">
            {summary.period} · {summary.plan} plan · invoice {summary.invoice.status}
          </p>
          <div className="grid-2">
            <div className="card">
              <div className="card-title">Token quota · {pct(summary.tokensUsed, summary.tokenQuota)}%</div>
              <div className="stat-value mono">{summary.tokensUsed.toLocaleString()}</div>
              <div className="page-sub mono">of {summary.tokenQuota.toLocaleString()} tokens</div>
              <div style={{ height: 10, borderRadius: 6, background: "#15151a", overflow: "hidden" }}>
                <div style={{ width: `${pct(summary.tokensUsed, summary.tokenQuota)}%`, height: "100%", background: "var(--lime)" }} />
              </div>
            </div>
            <div className="card">
              <div className="card-title">Spend quota · {pct(summary.spendUsd, summary.quotaUsd)}%</div>
              <div className="stat-value mono">${summary.spendUsd.toFixed(4)}</div>
              <div className="page-sub mono">of ${summary.quotaUsd} cap</div>
              <div style={{ height: 10, borderRadius: 6, background: "#15151a", overflow: "hidden" }}>
                <div style={{ width: `${pct(summary.spendUsd, summary.quotaUsd)}%`, height: "100%", background: "var(--violet)" }} />
              </div>
              <div className="section">
                <div className="card-title">Invoice draft</div>
                <div className="row-between">
                  <span className="mono">${summary.invoice.amountUsd.toFixed(4)}</span>
                  <span className="pill">
                    <span className="dot dot-warn" />
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
