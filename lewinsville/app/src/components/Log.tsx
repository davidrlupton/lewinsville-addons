"use client";
import { useEffect, useState } from "react";
import type { Entry } from "@/lib/log";

const BADGE: Record<Entry["source"], [string, string]> = { jarvis: ["♪", "Teddy"], app: ["✦", "Talk"], button: ["⌂", "Button"] };
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Every ask of the house in the last two weeks. Owners only. Thumbs-down flags a miss for the monthly review. */
export function Log() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [days, setDays] = useState(14);
  useEffect(() => { fetch(`/api/log?days=${days}`).then((r) => r.json()).then((j) => setEntries(j.entries ?? [])).catch(() => setEntries([])); }, [days]);
  const flag = async (e: Entry) => {
    setEntries((es) => es?.map((x) => (x.id === e.id ? { ...x, flagged: !e.flagged } : x)) ?? null);
    await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, on: !e.flagged }) });
  };
  if (!entries) return <div className="card p-6 text-center opacity-70">Reading the log…</div>;
  const talk = entries.filter((e) => e.source !== "button");
  const med = talk.length ? [...talk].sort((a, b) => a.ms - b.ms)[Math.floor(talk.length / 2)].ms : 0;
  const flagged = entries.filter((e) => e.flagged).length;
  return (
    <div className="space-y-3">
      <div className="card flex items-center justify-between p-3 text-sm">
        <div><span className="font-extrabold">{entries.length}</span> asks · <span className="font-extrabold">{entries.filter((e) => e.source === "jarvis").length}</span> by voice · typical reply <span className="font-extrabold">{(med / 1000).toFixed(1)}s</span>{flagged ? <> · <span className="font-extrabold text-saffron">{flagged} flagged</span></> : null}</div>
        <div className="flex gap-1 text-xs font-bold">{[7, 14, 30].map((d) => <button key={d} className="rounded-full px-2.5 py-1" style={{ background: days === d ? "var(--ink)" : "var(--cream)", color: days === d ? "var(--cream)" : "var(--ink)" }} onClick={() => setDays(d)}>{d}d</button>)}</div>
      </div>
      {entries.length === 0 && <div className="card p-4 text-sm opacity-70">Nothing yet. Ask Teddy something.</div>}
      {entries.map((e, i) => {
        const d = fmtDay(e.at); const head = i === 0 || fmtDay(entries[i - 1].at) !== d;
        const [icon, label] = BADGE[e.source];
        return (
          <div key={e.id}>
            {head && <div className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide opacity-50">{d}</div>}
            <div className="card p-3 text-sm" style={{ outline: e.flagged ? "2px solid var(--saffron)" : "none" }}>
              <div className="flex items-center justify-between text-xs opacity-60"><span><span className="mr-1">{icon}</span>{label} · {e.who} · {fmtTime(e.at)}</span><span>{e.ms ? `${(e.ms / 1000).toFixed(1)}s` : ""}{e.ok ? "" : " · failed"}</span></div>
              {e.asked && <div className="mt-1 font-bold">“{e.asked}”</div>}
              {e.reply && <div className="mt-0.5 opacity-80">{e.reply}</div>}
              {e.did.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{e.did.slice(0, 6).map((x, i) => <span key={i} className="rounded-full bg-ink/10 px-2 py-0.5 text-[11px]">{x.length > 60 ? x.slice(0, 60) + "…" : x}</span>)}</div>}
              <button className="mt-2 text-xs font-bold opacity-60" onClick={() => flag(e)}>{e.flagged ? "✓ flagged for review · unflag" : "👎 flag as a miss"}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
