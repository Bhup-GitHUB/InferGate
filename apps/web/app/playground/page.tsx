"use client";

import { useEffect, useState } from "react";
import { KeyGate } from "@/components/KeyGate";
import { getKey, listModels, streamChat, type ChatMessage, type ModelEntry } from "@/lib/api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  provider?: string;
}

export default function Playground(): React.ReactElement {
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
            next[next.length - 1] = { role: "assistant", content: acc, provider };
            return next;
          });
        },
        (p) => setProvider(p),
      );
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = { role: "assistant", content: acc, provider: provider || undefined };
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
    <div>
      <h1 className="page-title">Playground</h1>
      <p className="page-sub">Stream tokens through the gateway exactly like production clients do.</p>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Conversation</div>
          <div className="chat-wrap">
            {turns.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14 }}>No messages yet. Ask anything.</p>}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "msg msg-user" : "msg msg-assistant"}>
                <div className="msg-role">
                  {t.role}
                  {t.provider ? ` · ${t.provider}` : ""}
                </div>
                {t.content}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="card">
            <div className="card-title">Model</div>
            <select className="select mono" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.owned_by}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 12 }} className="card-title">
              Routed via
            </div>
            <div className="pill">
              <span className="dot dot-ok" />
              <span className="mono">{provider === "" ? "auto" : provider}</span>
            </div>
          </div>
          <div className="card section">
            <div className="card-title">Prompt</div>
            <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Explain black holes like I am five…" />
            <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={send} disabled={busy}>
              {busy ? "Streaming…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
