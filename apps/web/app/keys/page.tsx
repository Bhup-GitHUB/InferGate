"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "@/components/KeyGate";
import { createKey, getKey, revokeKey, rotateKey } from "@/lib/api";

interface Row {
  id: string;
  prefix: string;
  secret: string | null;
}

export default function Keys(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [scopes, setScopes] = useState("chat:write,models:read,usage:read");
  const [error, setError] = useState("");

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  async function create(): Promise<void> {
    setError("");
    try {
      const res = await createKey(
        getKey(),
        scopes.split(",").map((s) => s.trim()).filter((s) => s !== ""),
      );
      setRows((r) => [{ id: res.id, prefix: res.prefix, secret: res.api_key }, ...r]);
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
    <div>
      <h1 className="page-title">API keys</h1>
      <p className="page-sub">Secrets are shown once at creation. Rotation keeps a 24h grace window.</p>
      <div className="card">
        <div className="card-title">New key scopes</div>
        <div style={{ display: "flex", gap: 12 }}>
          <input className="input mono" value={scopes} onChange={(e) => setScopes(e.target.value)} />
          <button className="btn btn-primary" onClick={create}>
            Create key
          </button>
        </div>
        {error !== "" && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      </div>
      <div className="card section">
        <div className="card-title">Session keys</div>
        {rows.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14 }}>No keys created in this session yet.</p>}
        {rows.map((r) => (
          <div key={r.id} style={{ borderTop: "1px solid var(--line)", padding: "14px 0" }}>
            <div className="row-between">
              <span className="mono">…{r.prefix}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => rotate(r.id)}>
                  Rotate
                </button>
                <button className="btn btn-danger" onClick={() => revoke(r.id)}>
                  Revoke
                </button>
              </div>
            </div>
            {r.secret && (
              <div className="key-box mono" style={{ marginTop: 10 }}>
                {r.secret}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
