"use client";
import { useEffect, useState } from "react";
import type { Energy as E, Range } from "@/lib/energy";

const RANGES: [Range, string][] = [["today", "Today"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];
const kw = (w: number) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);

/** The whole home first: live flow, then where the energy went. Detail (per circuit, per cube) only for owners. */
export function Energy({ detail }: { detail: boolean }) {
  const [range, setRange] = useState<Range>("today");
  const [e, setE] = useState<E | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch(`/api/energy?range=${range}`).then(async (r) => { if (!live) return; if (r.ok) { setE(await r.json()); setErr(null); } else setErr("Energy data unavailable"); }).catch(() => live && setErr("Offline"));
    load(); const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [range]);

  if (err) return <div className="card p-4 text-sm opacity-70">{err}</div>;
  if (!e) return <div className="card p-6 text-center opacity-70">Adding it up…</div>;
  const importing = e.live.grid >= 0;
  const charging = e.live.battery < 0; // EP Cube reports charge as negative power
  const maxSeries = Math.max(1, ...e.series.map((s) => Math.max(s.load, s.solar)));
  const maxKwh = Math.max(0.01, ...e.circuits.map((c) => c.kwh));
  const now = [...e.circuits].sort((a, b) => b.watts - a.watts).filter((c) => c.watts > 20).slice(0, 8);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-2">
        {([
          ["Solar", kw(e.live.solar), e.live.solar > 50 ? "making power" : "resting", "var(--marigold)"],
          ["Home", kw(e.live.load), "using now", "var(--ink-soft)"],
          ["Grid", kw(Math.abs(e.live.grid)), importing ? "coming in" : "going out", importing ? "var(--saffron)" : "var(--peacock)"],
          ["Battery", e.live.soc != null ? `${e.live.soc}%` : "–", e.live.battery === 0 ? "idle" : charging ? `charging ${kw(e.live.battery)}` : `giving ${kw(e.live.battery)}`, "var(--indigo)"],
        ] as const).map(([k, v, sub, c]) => (
          <div key={k} className="card p-3">
            <div className="text-xs font-bold uppercase opacity-60">{k}</div>
            <div className="display text-3xl font-extrabold" style={{ color: c }}>{v}</div>
            <div className="text-xs opacity-60">{sub}</div>
          </div>
        ))}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">The whole home</h2>
          <div className="flex gap-1 text-xs font-bold">
            {RANGES.map(([k, l]) => <button key={k} className="rounded-full px-3 py-1.5" style={{ background: range === k ? "var(--ink)" : "var(--cream)", color: range === k ? "var(--cream)" : "var(--ink)" }} onClick={() => setRange(k)}>{l}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {([["Used", e.totals.load], ["Solar", e.totals.solar], ["From grid", e.totals.gridIn], ["To grid", e.totals.gridOut], ["Battery in", e.totals.battIn], ["Battery out", e.totals.battOut]] as const).map(([k, v]) => (
            <div key={k}><div className="display text-2xl font-extrabold">{v}</div><div className="text-xs font-bold uppercase opacity-60">{k} kWh</div></div>
          ))}
        </div>
        {e.series.length > 1 && (
          <div className="mt-4">
            <div className="flex h-24 items-end gap-[2px]">
              {e.series.map((s, i) => (
                <div key={i} className="flex flex-1 flex-col justify-end gap-[1px]" title={`${s.label}: used ${s.load}, solar ${s.solar}`}>
                  <div style={{ height: `${(s.solar / maxSeries) * 100}%`, background: "var(--marigold)", borderRadius: 2 }} />
                  <div style={{ height: `${(s.load / maxSeries) * 100}%`, background: "var(--ink-soft)", borderRadius: 2, opacity: .7 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] font-bold opacity-50"><span>{e.series[0].label}{range === "today" ? "h" : ""}</span><span>solar ▮ used ▮</span><span>{e.series[e.series.length - 1].label}{range === "today" ? "h" : ""}</span></div>
          </div>
        )}
        {e.live.cubes < 2 && <div className="mt-3 text-xs opacity-60">Only one EP Cube is reporting, so these are half the house until the left cube is added.</div>}
      </section>

      {detail && now.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-extrabold">Drawing power right now</h2>
          <div className="card divide-y divide-black/5 p-2">
            {now.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-2 py-2 text-sm"><span className="font-bold">{c.name}</span><span className="opacity-70">{kw(c.watts)}</span></div>
            ))}
          </div>
        </section>
      )}

      {detail && (
        <section>
          <h2 className="mb-2 text-lg font-extrabold">Where it went</h2>
          <div className="card p-3">
            {e.circuits.filter((c) => c.kwh > 0).map((c) => (
              <div key={c.id} className="py-1.5">
                <div className="flex items-center justify-between text-sm"><span className="font-bold">{c.name}<span className="ml-2 text-xs font-normal opacity-50">{c.panel}</span></span><span>{c.kwh} kWh</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-black/5"><div className="h-1.5 rounded-full" style={{ width: `${(c.kwh / maxKwh) * 100}%`, background: "var(--marigold)" }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {detail && e.cubes.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-extrabold">By system</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {e.cubes.map((c) => (
              <div key={c.name} className="card p-3 text-sm">
                <div className="font-bold">{c.name}{c.soc != null ? <span className="ml-2 text-xs font-normal opacity-60">battery {c.soc}%</span> : null}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 opacity-80"><span>Used {c.load}</span><span>Solar {c.solar}</span><span>From grid {c.gridIn}</span><span>To grid {c.gridOut}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
