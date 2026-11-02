"use client";
// People, for owners: everyone on the list with a four-way switch. On is normal; 1 hr and Till 7 am are a
// time-out; Off stays off until an owner turns it back on. Owners cannot be switched. A wifi-only person
// also shows whether their phone is on the house network right now.
import { useCallback, useEffect, useState } from "react";
import { Segmented } from "@/components/Segmented";

type Kind = "on" | "hour" | "morning" | "off";
type P = { email: string; name: string; role: string; wifiOnly: boolean; device?: string; home: boolean | null; pause: { kind: Kind; until: string | null; by: string } | null };
const KINDS = [["on", "On"], ["hour", "1 hr"], ["morning", "Till 7 am"], ["off", "Off"]] as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function line(p: P) {
  const bits = [p.role];
  if (p.wifiOnly) bits.push(p.home === true ? "home wifi · phone here" : p.home === false ? "home wifi · phone away" : "home wifi only");
  if (p.pause) bits.push(p.pause.until ? `paused until ${clock(p.pause.until)}` : "off");
  return bits.join(" · ");
}

export function People() {
  const [people, setPeople] = useState<P[] | null>(null);
  const load = useCallback(() => fetch("/api/people").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setPeople(j.people); }).catch(() => { /* next time */ }), []);
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { void load(); }, [load]);
  const set = async (email: string, kind: Kind) => {
    setPeople((ps) => ps && ps.map((p) => (p.email === email ? { ...p, pause: kind === "on" ? null : { kind, until: null, by: "you" } } : p)));
    await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, kind }) });
    void load();
  };
  if (!people) return null;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between"><h2 className="text-lg font-extrabold">People</h2><span className="label">owners only</span></div>
      <div className="space-y-3">
        {people.map((p) => (
          <div key={p.email} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-extrabold">{p.name}</div>
              <div className="truncate text-xs text-ink-soft">{line(p)}</div>
            </div>
            {p.role === "owner" ? <span className="label shrink-0">owner</span> : (
              <div className="w-52 shrink-0"><Segmented value={p.pause?.kind ?? "on"} options={KINDS} onChange={(k) => set(p.email, k)} label={`${p.name} access`} /></div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
