"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string; content?: unknown };
type SR = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; lang: string; interimResults: boolean };
declare global { interface Window { webkitSpeechRecognition?: new () => SR; SpeechRecognition?: new () => SR } }

export function Chat({ enabled, name }: { enabled: boolean; name: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const rec = useRef<SR | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const t = text.trim(); if (!t || busy) return;
    setInput("");
    const history = [...msgs, { role: "user" as const, text: t }];
    setMsgs(history);
    setBusy(true);
    const api = history.map((m) => ({ role: m.role, content: m.role === "assistant" && m.content ? m.content : m.text }));
    let reply = "";
    setMsgs([...history, { role: "assistant", text: "" }]);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: api }) });
      if (!r.ok || !r.body) { reply = r.status === 503 ? "Chat isn't switched on yet. David needs to add the key." : "Something went wrong."; }
      else {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        let content: unknown;
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
          for (const p of parts) {
            if (!p.startsWith("data: ")) continue;
            const ev = JSON.parse(p.slice(6));
            if (ev.text) { reply += ev.text; setMsgs([...history, { role: "assistant", text: reply }]); }
            if (ev.done) content = ev.content;
            if (ev.error) reply += `\n(${ev.error})`;
          }
        }
        setMsgs([...history, { role: "assistant", text: reply || "Done.", content }]);
        if (speak && reply && "speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(reply); u.rate = 1.05; speechSynthesis.speak(u); }
        return;
      }
    } catch { reply = "Couldn't reach the house."; }
    setMsgs([...history, { role: "assistant", text: reply }]);
    setBusy(false);
  }
  useEffect(() => { if (!busy) return; const id = setTimeout(() => setBusy(false), 0); return () => clearTimeout(id); }, [msgs, busy]);

  function mic() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) { alert("Voice needs Safari or Chrome."); return; }
    if (listening) { rec.current?.stop(); return; }
    const r = new Ctor(); r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e) => { const t = e.results[0][0].transcript; setInput(t); send(t); };
    r.onend = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  }

  const starters = ["Make the living room cozy", "Open all the shades", "What's the temperature upstairs?", "Goodnight"];
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-1 pb-4">
        {msgs.length === 0 && (
          <div className="card p-5">
            <div className="display text-2xl font-extrabold">Hi {name}. Tell me what you want.</div>
            <p className="mt-1 text-sm opacity-70">Lights, shades, temperature, music, or the whole house at once.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {starters.map((s) => <button key={s} className="rounded-full bg-marigold/30 px-3 py-2 text-sm font-bold" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-snug ${m.role === "user" ? "ml-auto bg-ink text-cream" : "card"}`}>
            {m.text || <span className="pulse">…</span>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="flex items-center gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <button type="button" onClick={mic} aria-label="talk" className="h-12 w-12 shrink-0 rounded-full text-xl" style={{ background: listening ? "var(--rani)" : "var(--peacock)", color: "white" }}>{listening ? "●" : "🎤"}</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={enabled ? "Ask the house…" : "Chat not switched on yet"} disabled={!enabled}
          className="h-12 flex-1 rounded-full bg-card px-4 text-[16px] outline-none ring-2 ring-transparent focus:ring-marigold" />
        <button type="submit" className="h-12 rounded-full bg-saffron px-4 font-bold text-white disabled:opacity-40" disabled={!enabled || !input.trim()}>Send</button>
        <button type="button" onClick={() => setSpeak(!speak)} className="h-12 w-12 rounded-full bg-card text-lg" aria-label="speak replies">{speak ? "🔊" : "🔇"}</button>
      </form>
    </div>
  );
}
