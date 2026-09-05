"use client";

import { useState } from "react";
import { setKey } from "../lib/api";

export function KeyGate({ onReady }: { onReady: () => void }): React.ReactElement {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="mx-auto max-w-xl py-[12vh] text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-acid to-ice text-lg font-black text-void">
        I
      </div>
      <h1 className="mt-5 text-3xl font-extrabold tracking-tight">Connect to InferGate</h1>
      <p className="mb-8 mt-2 text-sm text-fog">Paste an API key to open the console. Keys stay in your browser.</p>
      <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-6 text-left">
        <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">API key</div>
        <input
          className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm text-white outline-none focus:border-acid focus:shadow-[0_0_0_3px_rgba(200,255,46,0.12)]"
          placeholder="ig_sk_..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error !== "" && <p className="text-[13px] text-red-400">{error}</p>}
        <button
          className="mt-3.5 w-full rounded-xl border border-acid bg-acid px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(200,255,46,0.35)] transition hover:-translate-y-px hover:shadow-[0_0_32px_rgba(200,255,46,0.55)]"
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
