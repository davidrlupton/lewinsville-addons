"use client";
import { useEffect, useState } from "react";
import type { Bucket, Energy as E, Range } from "@/lib/energy";

const RANGES: [Range, string][] = [["today", "Today"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];
const kw = (w: number) => (Math.abs(w) >= 1000 ? `${(Math.abs(w) / 1000).toFixed(1)} kW` : `${Math.round(Math.abs(w))} W`);
const kwh = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1));
const SUN = "var(--marigold)", GRID = "var(--saffron)", BATT = "var(--peacock)", HOME = "var(--ink)", BOUGHT = "var(--ink-soft)";

/** The whole home first: live flow, then what the range added up to. Detail (per circuit, per cube) only for owners. */
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
  const rangeWord = { today: "so far today", week: "this week", month: "this month", year: "this year" }[e.range];

  return (
    <div className="space-y-5">
      <Flow live={e.live} />

      <section className="card p-4">
        <h2 className="text-lg font-extrabold">Added up</h2>
        <div className="my-3 grid grid-cols-4 gap-1 text-xs font-bold">
          {RANGES.map(([k, l]) => <button key={k} className="rounded-full py-1.5" style={{ background: range === k ? "var(--ink)" : "var(--cream)", color: range === k ? "var(--cream)" : "var(--ink)" }} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        {e.totals.load > 0 ? (
          <p className="text-sm leading-snug">
            The house used <b>{kwh(e.totals.load)} kWh</b> {rangeWord}; the sun made <b>{kwh(e.totals.solar)} kWh</b>.
            {e.totals.selfPct != null && <> <b>{e.totals.selfPct}%</b> of what we used was our own sun and battery.</>}
          </p>
        ) : <p className="text-sm opacity-70">Nothing recorded {rangeWord} yet.</p>}
        {e.totals.selfPct != null && (
          <div className="mt-3">
            <div className="flex h-3 overflow-hidden rounded-full" style={{ background: "var(--cream)" }}>
              <div style={{ width: `${e.totals.selfPct}%`, background: SUN }} />
              <div style={{ width: `${100 - e.totals.selfPct}%`, background: BOUGHT, opacity: .45 }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] font-bold opacity-60"><span>Our own {e.totals.selfPct}%</span><span>Bought {100 - e.totals.selfPct}%</span></div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-4 gap-1 text-center">
          {([["Used", e.totals.load, HOME], ["Sun made", e.totals.solar, SUN], ["Bought", e.totals.gridIn, GRID], ["Sold", e.totals.gridOut, GRID]] as const).map(([k, v, c]) => (
            <div key={k}><div className="display text-xl font-extrabold" style={{ color: c }}>{kwh(v)}</div><div className="text-[10px] font-bold uppercase opacity-60">{k}</div></div>
          ))}
        </div>
        <Chart series={e.series} range={e.range} />
        {e.since && <div className="mt-2 text-xs opacity-60">Records start {e.since}.</div>}
        {e.live.cubes < 2 && <div className="mt-2 text-xs opacity-60">Only one EP Cube is reporting, so these are half the house.</div>}
      </section>

      <Battery e={e} />

      {detail && <Circuits e={e} />}

      {detail && e.cubes.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-extrabold">By system</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {e.cubes.map((c) => (
              <div key={c.name} className="card p-3 text-sm">
                <div className="flex items-center justify-between"><span className="font-bold">{c.name}</span>{c.soc != null && <span className="text-xs font-bold" style={{ color: BATT }}>battery {c.soc}%</span>}</div>
                <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs opacity-80">
                  <span>Used {kwh(c.load)}</span><span>Sun {kwh(c.solar)}</span><span>Charged {kwh(c.battIn)}</span>
                  <span>Bought {kwh(c.gridIn)}</span><span>Sold {kwh(c.gridOut)}</span><span>Gave back {kwh(c.battOut)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Node({ label, value, sub, color, big }: { label: string; value: string; sub: string; color: string; big?: boolean }) {
  return (
    <div className={`card flex flex-col justify-center ${big ? "p-4" : "px-3 py-2"}`}>
      <div className="text-[10px] font-bold uppercase opacity-60">{label}</div>
      <div className={`display font-extrabold leading-tight ${big ? "text-3xl" : "text-lg"}`} style={{ color }}>{value}</div>
      <div className="text-[11px] opacity-60">{sub}</div>
    </div>
  );
}

/** Right now: sun, grid and battery on the left, each with a moving line into (or out of) the home. */
function Flow({ live }: { live: E["live"] }) {
  const buying = live.grid > 0, selling = live.grid < 0;
  const charging = live.battery > 50, giving = live.battery < -50;
  const width = (w: number) => 1.5 + Math.min(6, (Math.abs(w) / 4000) * 6);
  const line = (y: number, active: boolean, out: boolean, color: string, w: number) => (
    <path d={`M0,${y} C50,${y} 50,50 100,50`} fill="none" stroke={color} strokeWidth={width(w)} vectorEffect="non-scaling-stroke" className={`flow-line${!active ? " idle" : out ? " rev" : ""}`} />
  );
  return (
    <section className="grid grid-cols-[1fr_minmax(2.5rem,1fr)_1.25fr] items-stretch gap-0">
      <div className="flex flex-col gap-2">
        <Node label="Sun" value={kw(live.solar)} sub={live.solar > 50 ? "making" : "resting"} color={SUN} />
        <Node label="Grid" value={kw(live.grid)} sub={buying ? "buying" : selling ? "selling" : "quiet"} color={GRID} />
        <Node label="Battery" value={live.soc != null ? `${live.soc}%` : "–"} sub={charging ? `charging ${kw(live.battery)}` : giving ? `giving ${kw(live.battery)}` : "holding"} color={BATT} />
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        {line(17, live.solar > 50, false, SUN, live.solar)}
        {line(50, buying || selling, selling, GRID, live.grid)}
        {line(83, charging || giving, charging, BATT, live.battery)}
      </svg>
      <Node label="Home" value={kw(live.load)} sub="using right now" color={HOME} big />
    </section>
  );
}

/** Bars of what the house used (gold = our own, grey = bought), with a thin line for what the sun made. */
function Chart({ series, range }: { series: Bucket[]; range: Range }) {
  const max = Math.max(0.1, ...series.map((s) => Math.max(s.load, s.solar)));
  const n = series.length;
  const nowIdx = range === "today" ? series.filter((s) => s.has).length : n;
  const ticks = range === "today" ? [0, 6, 12, 18] : range === "week" ? series.map((_, i) => i) : range === "month" ? series.map((_, i) => i).filter((i) => i % 7 === n % 7 - 1 || i === n - 1) : series.map((_, i) => i);
  const pts = series.slice(0, nowIdx).map((s, i) => `${i + 0.5},${100 - (s.solar / max) * 100}`).join(" ");
  return (
    <div className="mt-4">
      <div className="relative h-28">
        <div className="flex h-full items-end gap-[2px]">
          {series.map((s, i) => {
            const self = Math.max(0, s.load - s.gridIn), bought = Math.min(s.load, s.gridIn);
            return (
              <div key={s.t} className="flex h-full flex-1 flex-col justify-end" style={{ opacity: i >= nowIdx ? .35 : 1 }} title={`${s.label}: used ${s.load} kWh (${self.toFixed(1)} ours, ${bought.toFixed(1)} bought), sun ${s.solar} kWh`}>
                <div style={{ height: `${(self / max) * 100}%`, background: SUN, borderRadius: "2px 2px 0 0" }} />
                <div style={{ height: `${(bought / max) * 100}%`, background: BOUGHT, opacity: .45, borderRadius: self > 0 ? 0 : "2px 2px 0 0" }} />
              </div>
            );
          })}
        </div>
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <polyline points={pts} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeOpacity={.55} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="relative mt-1 h-4 text-[10px] font-bold opacity-50">
        {ticks.map((i) => <span key={i} className={`absolute ${i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${((i + (i === 0 ? 0 : i === n - 1 ? 1 : 0.5)) / n) * 100}%` }}>{series[i].label}</span>)}
      </div>
      <div className="mt-1 flex gap-3 text-[10px] font-bold opacity-60">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: SUN }} />our own</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: BOUGHT, opacity: .45 }} />bought</span>
        <span><i className="mr-1 inline-block w-3 border-t border-dashed align-middle" style={{ borderColor: "var(--ink)" }} />sun made</span>
      </div>
    </div>
  );
}

/** Battery: level now, what it did over the range, and how it rose and fell. */
function Battery({ e }: { e: E }) {
  const soc = e.live.soc;
  const pts = e.series.filter((s) => s.soc != null);
  const n = e.series.length;
  const line = pts.map((s) => `${e.series.indexOf(s) + 0.5},${100 - (s.soc ?? 0)}`).join(" ");
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">Battery</h2>
        <div className="display text-2xl font-extrabold" style={{ color: BATT }}>{soc != null ? `${soc}%` : "–"}</div>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full" style={{ background: "var(--cream)" }}><div className="h-full rounded-full" style={{ width: `${soc ?? 0}%`, background: BATT }} /></div>
      <div className="mt-2 flex justify-between text-xs opacity-70"><span>Charged <b>{kwh(e.totals.battIn)} kWh</b></span><span>Gave back <b>{kwh(e.totals.battOut)} kWh</b></span></div>
      {pts.length > 1 && (
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="mt-2 h-12 w-full" aria-hidden>
          <line x1={0} x2={n} y1={50} y2={50} stroke="var(--ink)" strokeOpacity={.12} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <polyline points={line} fill="none" stroke={BATT} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      )}
    </section>
  );
}

/** Owners: every circuit on both SPAN panels, by energy used or by what is drawing now. */
function Circuits({ e }: { e: E }) {
  const [by, setBy] = useState<"kwh" | "watts">("kwh");
  const [all, setAll] = useState(false);
  const rows = [...e.circuits].sort((a, b) => b[by] - a[by] || b.kwh - a.kwh).filter((c) => c[by] > 0);
  const max = Math.max(0.01, ...rows.map((c) => c[by]));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-extrabold">By circuit</h2>
        <div className="flex gap-1 text-xs font-bold">
          {([["kwh", "Energy"], ["watts", "Right now"]] as const).map(([k, l]) => <button key={k} className="rounded-full px-3 py-1" style={{ background: by === k ? "var(--ink)" : "var(--cream)", color: by === k ? "var(--cream)" : "var(--ink)" }} onClick={() => setBy(k)}>{l}</button>)}
        </div>
      </div>
      <div className="card p-3">
        {shown.map((c) => (
          <div key={c.id} className="py-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate font-bold">{c.name}<span className="ml-2 text-[10px] font-bold uppercase opacity-40">{c.panel}</span></span>
              <span className="shrink-0 pl-2 tabular-nums">{by === "kwh" ? `${c.kwh} kWh` : kw(c.watts)}<span className="ml-2 text-xs opacity-50">{by === "kwh" ? kw(c.watts) : `${c.kwh} kWh`}</span></span>
            </div>
            <div className="mt-1 h-1.5 rounded-full" style={{ background: "var(--cream)" }}><div className="h-1.5 rounded-full" style={{ width: `${(c[by] / max) * 100}%`, background: by === "kwh" ? SUN : GRID }} /></div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm opacity-60">Nothing yet.</div>}
        {rows.length > 10 && <button className="mt-2 text-xs font-bold opacity-60" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
      </div>
    </section>
  );
}
