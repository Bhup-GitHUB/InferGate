"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "../../components/KeyGate";
import { createKey, getKey, listKeys, revokeKey, rotateKey } from "../../lib/api";

interface Row {
  id: string;
  prefix: string;
  secret: string | null;
}

export default function Keys(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [scopes, setScopes] = useState("chat:write,models:read,usage:read");
  const [expiry, setExpiry] = useState("");
  const [tier, setTier] = useState("standard");
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
    listKeys(getKey())
      .then((r) => setRows(r.data.map((k) => ({ id: k.id, prefix: k.prefix, secret: null }))))
      .catch(() => setError("Listing needs keys:write scope."));
  }, [ready]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  async function create(): Promise<void> {
    setError("");
    try {
      const days = expiry.trim() === "" ? undefined : Number(expiry.trim());
      const res = await createKey(
        getKey(),
        scopes.split(",").map((s) => s.trim()).filter((s) => s !== ""),
        days,
        tier,
      );
      setRows((r) => [{ id: res.id, prefix: res.prefix, secret: res.api_key }, ...r]);
      setExpiry("");
    } catch {
      setError("Creation failed. This key needs keys:write scope.");
    }
  }

  async function rotate(id: string): Promise<void> {
    try {
      const res = await rotateKey(getKey(), id);
      setRows((r) => r.map((x) => (x.id === id ? { ...x, secret: res.api_key } : x)));
    } catch {
      setError("Rotation failed.");
    }
  }

  async function revoke(id: string): Promise<void> {
    try {
      await revokeKey(getKey(), id);
      setRows((r) => r.filter((x) => x.id !== id));
    } catch {
      setError("Revocation failed.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">API keys</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Secrets are shown once at creation. Rotation keeps a 24h grace window.</p>
      <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">New key scopes</div>
        <div className="flex gap-3">
          <input
            className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
          />
          <input
            className="w-32 shrink-0 rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            placeholder="days"
          />
          <select
            className="w-32 shrink-0 rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            {["standard", "plus", "scale"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            className="shrink-0 rounded-xl border border-acid bg-acid px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(200,255,46,0.35)] transition hover:-translate-y-px"
            onClick={create}
          >
            Create key
          </button>
        </div>
        {error !== "" && <p className="text-[13px] text-red-400">{error}</p>}
      </div>
      <div className="mt-4 rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
        <div className="mb-2 text-xs uppercase tracking-[0.12em] text-fog">Organization keys</div>
        {rows.length === 0 && <p className="text-sm text-fog">No keys yet. Create one above.</p>}
        {rows.map((r) => (
          <div key={r.id} className="border-t border-edge py-3.5 first:border-t-0">
            <div className="flex items-center justify-between">
              <span className="font-mono">…{r.prefix}</span>
              <div className="flex gap-2">
                <button
                  className="rounded-xl border border-edge bg-panel2 px-4 py-2 text-sm font-semibold transition hover:-translate-y-px"
                  onClick={() => rotate(r.id)}
                >
                  Rotate
                </button>
                <button
                  className="rounded-xl border border-[#4a2323] px-4 py-2 text-sm font-semibold text-red-400 transition hover:-translate-y-px"
                  onClick={() => revoke(r.id)}
                >
                  Revoke
                </button>
              </div>
            </div>
            {r.secret && (
              <div className="mt-2.5 break-all rounded-xl border border-dashed border-[#3a3a44] bg-[#08080a] p-3.5 font-mono text-[13px] text-acid">
                {r.secret}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
