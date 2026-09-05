"use client";

import { useState } from "react";
import { setKey } from "@/lib/api";

export function KeyGate({ onReady }: { onReady: () => void }): React.ReactElement {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="gate">
      <div className="brand-mark" style={{ margin: "0 auto" }}>
        I
      </div>
      <h1 className="page-title" style={{ marginTop: 18 }}>
        Connect to InferGate
      </h1>
      <p className="page-sub">Paste an API key to open the console. Keys stay in your browser.</p>
      <div className="card gate-card">
        <div className="card-title">API key</div>
        <input
          className="input mono"
          placeholder="ig_sk_..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error !== "" && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        <button
          className="btn btn-primary"
          style={{ marginTop: 14, width: "100%" }}
          onClick={() => {
            if (!value.startsWith("ig_sk_")) {
              setError("Key must start with ig_sk_");
              return;
            }
            setKey(value.trim());
            onReady();
          }}
        >
          Unlock console
        </button>
      </div>
    </div>
  );
}
