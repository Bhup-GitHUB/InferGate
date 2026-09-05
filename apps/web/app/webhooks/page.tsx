"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { addWebhook, getKey, listWebhooks, removeWebhook } from "../../lib/api";

interface Row {
  id: string;
  url: string;
  events: string[];
}

const ALL = ["quota.warning", "quota.exceeded", "provider.outage"];

export default function Webhooks(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      const r = await listWebhooks(getKey());
      setRows(r.data);
    } catch {
      setError("Listing needs keys:write scope.");
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
      <h1 className="text-3xl font-extrabold tracking-tight">Webhooks</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">HMAC-signed alerts for quota breaches and provider outages.</p>
      <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">New endpoint</div>
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_auto]">
          <input
            className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            placeholder="https://ops.example.com/hook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            placeholder="signing secret (16+ chars)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button
            className="rounded-xl border border-acid bg-acid px-5 py-3 text-sm font-bold text-black transition hover:-translate-y-px"
            onClick={async () => {
              setError("");
              try {
                await addWebhook(getKey(), url.trim(), secret, ALL);
                setUrl("");
                setSecret("");
                await refresh();
              } catch {
                setError("Creation failed. Check URL, secret length, and scope.");
              }
            }}
          >
            Subscribe
          </button>
        </div>
        {error !== "" && <p className="text-[13px] text-red-400">{error}</p>}
      </div>
      <div className="mt-4 rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <div className="mb-2 text-xs uppercase tracking-[0.12em] text-fog">Endpoints</div>
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-t border-edge py-3.5 first:border-t-0">
            <div>
              <div className="font-mono text-sm">{r.url}</div>
              <div className="mt-1 font-mono text-xs text-fog">{r.events.join(" · ")}</div>
            </div>
            <button
              className="rounded-xl border border-[#4a2323] px-4 py-2 text-sm font-semibold text-red-400"
              onClick={async () => {
                await removeWebhook(getKey(), r.id);
                await refresh();
              }}
            >
              Delete
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-fog">No endpoints yet.</p>}
      </div>
    </div>
  );
}
