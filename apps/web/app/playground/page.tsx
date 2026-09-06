"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyGate } from "../../components/KeyGate";
import { getKey, listModels, streamChat, type ChatMessage, type ModelEntry } from "../../lib/api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  ms?: number;
}

export default function Playground(): React.ReactElement {
  return (
    <Suspense>
      <PlaygroundInner />
    </Suspense>
  );
}

function PlaygroundInner(): React.ReactElement {
  const search = useSearchParams();
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [model, setModel] = useState("auto");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("");

  useEffect(() => {
    if (getKey() !== "") {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const wanted = search.get("model");
    if (wanted) {
      setModel(wanted);
    }
  }, [search]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    listModels(getKey())
      .then((m) => {
        setModels(m);
        if (m.length > 0 && model === "auto" && !m.some((x) => x.id === "auto")) {
          setModel(m[0].id);
        }
      })
      .catch(() => undefined);
  }, [ready, model]);

  if (!ready) {
    return <KeyGate onReady={() => setReady(true)} />;
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (text === "" || busy) {
      return;
    }
    setBusy(true);
    setProvider("");
    const t0 = Date.now();
    const history: ChatMessage[] = [...turns.map((t) => ({ role: t.role, content: t.content }) as ChatMessage), { role: "user", content: text }];
    setTurns((t) => [...t, { role: "user", content: text }]);
    setInput("");
    let acc = "";
    setTurns((t) => [...t, { role: "assistant", content: "" }]);
    try {
      await streamChat(
        getKey(),
        model,
        history,
        (token) => {
          acc += token;
          setTurns((t) => {
            const next = [...t];
            next[next.length - 1] = { role: "assistant", content: acc };
            return next;
          });
        },
        (p) => setProvider(p),
      );
      const finalProvider = provider;
      const ms = Date.now() - t0;
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { role: "assistant", content: acc, provider: finalProvider || undefined, ms };
        return next;
      });
    } catch {
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { role: "assistant", content: "Request failed. Check quota, key scope, and gateway status." };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl flex-1 px-6 py-10 lg:px-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Playground</h1>
      <p className="mb-8 mt-1.5 text-sm text-fog">Stream tokens through the gateway exactly like production clients do.</p>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
          <div className="mb-3.5 text-xs uppercase tracking-[0.12em] text-fog">Conversation</div>
          <div className="flex flex-col gap-3.5">
            {turns.length === 0 && <p className="text-sm text-fog">No messages yet. Ask anything.</p>}
            {turns.map((t, i) => (
              <div
                key={i}
                className={
                  t.role === "user"
                    ? "max-w-[82%] self-end whitespace-pre-wrap rounded-2xl border border-[#2c3d12] bg-gradient-to-br from-[#1c2b0a] to-[#141a08] px-4.5 py-3.5 text-sm leading-relaxed"
                    : "max-w-[82%] self-start whitespace-pre-wrap rounded-2xl border border-edge bg-panel2 px-4.5 py-3.5 text-sm leading-relaxed"
                }
              >
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-fog">
                  {t.role}
                  {t.provider ? ` · ${t.provider}` : ""}
                  {t.ms !== undefined ? ` · ${(t.ms / 1000).toFixed(1)}s` : ""}
                </div>
                {t.content}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
            <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Model</div>
            <select
              className="w-full rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 font-mono text-sm outline-none focus:border-acid"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.owned_by}
                </option>
              ))}
            </select>
            <div className="mb-2.5 mt-3 text-xs uppercase tracking-[0.12em] text-fog">Routed via</div>
            <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-[#131318] px-3 py-1 text-xs font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-acid shadow-[0_0_8px_#c8ff2e]" />
              <span className="font-mono">{provider === "" ? "auto" : provider}</span>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-edge bg-gradient-to-b from-panel2 to-panel p-5">
            <div className="mb-2.5 text-xs uppercase tracking-[0.12em] text-fog">Prompt</div>
            <textarea
              className="min-h-[110px] w-full resize-y rounded-xl border border-edge bg-[#08080a] px-3.5 py-3 text-sm leading-relaxed outline-none focus:border-acid"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  send();
                }
              }}
              placeholder="Explain black holes like I am five… (⌘↵ to send)"
            />
            <button
              className="mt-3 w-full rounded-xl border border-acid bg-acid px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(200,255,46,0.35)] transition hover:-translate-y-px disabled:opacity-60"
              onClick={send}
              disabled={busy}
            >
              {busy ? "Streaming…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
