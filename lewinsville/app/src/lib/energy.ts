// Energy as the family wants to see it: the whole home first (both EP Cubes and both SPAN panels added
// together), the parts only in detail. Live numbers come from HA state; history comes from HA's
// long-term statistics, which it keeps forever at hourly resolution.
import { hub } from "./ha";

export type Range = "today" | "week" | "month" | "year";
export type Circuit = { id: string; name: string; panel: "Left" | "Right"; watts: number; kwh: number };
export type Energy = {
  range: Range;
  live: { solar: number; load: number; grid: number; battery: number; soc: number | null; cubes: number };
  totals: { solar: number; load: number; gridIn: number; gridOut: number; battIn: number; battOut: number };
  series: { label: string; load: number; solar: number; gridIn: number }[];
  circuits: Circuit[];
  cubes: { name: string; solar: number; load: number; gridIn: number; gridOut: number; soc: number | null }[];
  updated: number;
};

const TZ = "America/New_York";
// The two EP Cubes are sensor.epcube_l_* and sensor.epcube_r_* (entity ids tidied 2026-10-25). Whole-home
// numbers are the template sensors sensor.home_* on the hub (ha/templates.yaml), which add L and R.
const LIVE = {
  solar: /^sensor\.epcube_[lr]_solarpower$/,
  load: /^sensor\.epcube_[lr]_total_load_power$/,
  grid: /^sensor\.epcube_[lr]_gridpower$/,
  battery: /^sensor\.epcube_[lr]_batterypower$/,
  soc: /^sensor\.epcube_[lr]_batterysoc$/,
};
// Energy counters (kWh, daily totals; statistics "change" handles the midnight reset).
const COUNTERS = {
  solar: /^sensor\.epcube_[lr]_solarelectricity$/,
  load: /^sensor\.epcube_[lr]_total_load_energy$/,
  gridIn: /^sensor\.epcube_[lr]_gridelectricityfrom$/,
  gridOut: /^sensor\.epcube_[lr]_gridelectricityto$/,
  battIn: /^sensor\.epcube_[lr]_battery_daily_charge$/,
  battOut: /^sensor\.epcube_[lr]_battery_daily_discharge$/,
};
const CIRCUIT_POWER = /^sensor\.span_panel(_2)?_(?!main_meter|feed_through|current_power|solar)(.+)_power$/;

function num(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function nyParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}
/** Midnight in New York for the given instant, as a Date. */
function startOfDayNY(d = new Date()) {
  const { y, m, d: day } = nyParts(d);
  // Find the UTC instant whose NY wall clock is 00:00 on that date (handles DST by probing).
  let t = Date.UTC(y, m - 1, day, 5); // 05:00Z is midnight EST; adjust if DST
  const p = nyParts(new Date(t)); if (p.h !== 0) t -= p.h * 3600_000;
  return new Date(t);
}
function rangeStart(range: Range) {
  const mid = startOfDayNY();
  const days = range === "today" ? 0 : range === "week" ? 6 : range === "month" ? 29 : 364;
  return new Date(mid.getTime() - days * 86400_000);
}

const cache = new Map<string, { at: number; v: Energy }>();

export async function getEnergy(range: Range): Promise<Energy> {
  const hit = cache.get(range); if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const h = hub(); await h.connect(); await h.refreshRegistry();
  const ents = h.entities;
  const ids = Object.keys(ents);
  const sum = (re: RegExp) => ids.filter((i) => re.test(i)).reduce((s, i) => s + num(ents[i].state), 0);
  const socIds = ids.filter((i) => LIVE.soc.test(i));
  const live = {
    solar: sum(LIVE.solar), load: sum(LIVE.load), grid: sum(LIVE.grid), battery: sum(LIVE.battery),
    soc: socIds.length ? Math.round(socIds.reduce((s, i) => s + num(ents[i].state), 0) / socIds.length) : null,
    cubes: ids.filter((i) => LIVE.load.test(i)).length,
  };

  // Circuits: live watts from state, kWh from statistics on the matching consumed_energy counter.
  const circuitIds = ids.filter((i) => CIRCUIT_POWER.test(i));
  const circuits: Circuit[] = circuitIds.map((i) => {
    const m = CIRCUIT_POWER.exec(i)!;
    const name = String(ents[i].attributes.friendly_name ?? i).replace(/^(Span Panel( 2)?|SPAN (Left|Right)) /, "").replace(/ Power$/, "");
    return { id: i.replace(/_power$/, "_consumed_energy"), name, panel: m[1] ? "Right" : "Left", watts: Math.round(num(ents[i].state)), kwh: 0 };
  });

  const counterIds = Object.fromEntries(Object.entries(COUNTERS).map(([k, re]) => [k, ids.filter((i) => re.test(i))])) as Record<keyof typeof COUNTERS, string[]>;
  const statIds = [...circuits.map((c) => c.id), ...Object.values(counterIds).flat()];
  const start = rangeStart(range);
  const period = range === "today" ? "hour" : "day";
  type Row = { start: number; change: number | null };
  const stats = await h.send<Record<string, Row[]>>({ type: "recorder/statistics_during_period", start_time: start.toISOString(), statistic_ids: statIds, period, types: ["change"] });
  const total = (id: string) => (stats[id] ?? []).reduce((s, r) => s + (r.change ?? 0), 0);
  for (const c of circuits) c.kwh = +(total(c.id) / 1000).toFixed(2); // SPAN counts Wh
  const tot = (k: keyof typeof COUNTERS) => +counterIds[k].reduce((s, id) => s + total(id), 0).toFixed(1);
  const totals = { solar: tot("solar"), load: tot("load"), gridIn: tot("gridIn"), gridOut: tot("gridOut"), battIn: tot("battIn"), battOut: tot("battOut") };

  // Series per bucket for the little chart: hours today, days otherwise.
  const buckets = new Map<number, { load: number; solar: number; gridIn: number }>();
  const add = (k: "load" | "solar" | "gridIn") => { for (const id of counterIds[k]) for (const r of stats[id] ?? []) { const b = buckets.get(r.start) ?? { load: 0, solar: 0, gridIn: 0 }; b[k] += r.change ?? 0; buckets.set(r.start, b); } };
  add("load"); add("solar"); add("gridIn");
  const series = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => {
    const p = nyParts(new Date(t));
    const label = period === "hour" ? `${p.h}` : range === "year" ? `${p.m}/${p.d}` : `${p.m}/${p.d}`;
    return { label, load: +b.load.toFixed(1), solar: +b.solar.toFixed(1), gridIn: +b.gridIn.toFixed(1) };
  });

  // Per-cube detail by side. L feeds the left SPAN panel, R the right (David, 2026-10-25).
  const sides = (["l", "r"] as const).filter((s) => counterIds.load.some((i) => i.includes(`epcube_${s}_`)));
  const cubes = sides.map((side) => {
    const pick = (k: keyof typeof COUNTERS) => +counterIds[k].filter((i) => i.includes(`epcube_${side}_`)).reduce((s, id) => s + total(id), 0).toFixed(1);
    const soc = socIds.find((i) => i.includes(`epcube_${side}_`));
    return { name: side === "l" ? "Left cube" : "Right cube", solar: pick("solar"), load: pick("load"), gridIn: pick("gridIn"), gridOut: pick("gridOut"), soc: soc ? Math.round(num(ents[soc].state)) : null };
  });

  circuits.sort((a, b) => b.kwh - a.kwh || b.watts - a.watts);
  const v: Energy = { range, live, totals, series, circuits, cubes, updated: Date.now() };
  cache.set(range, { at: Date.now(), v });
  return v;
}

/** Short text for the model. */
export function describeEnergy(e: Energy) {
  const top = e.circuits.slice(0, 10).map((c) => `${c.name} (${c.panel}) ${c.kwh} kWh, ${c.watts} W now`).join("; ");
  return `Energy, ${e.range}: home used ${e.totals.load} kWh, solar made ${e.totals.solar} kWh, grid import ${e.totals.gridIn} kWh, export ${e.totals.gridOut} kWh, battery charged ${e.totals.battIn} / discharged ${e.totals.battOut} kWh. ` +
    `Right now: solar ${e.live.solar} W, home ${e.live.load} W, grid ${e.live.grid} W, battery ${e.live.battery} W at ${e.live.soc ?? "?"}%. Top circuits: ${top}.`;
}
