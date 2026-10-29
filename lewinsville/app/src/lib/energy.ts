// Energy as the family wants to see it: the whole home first (both EP Cubes and both SPAN panels added
// together), the parts only in detail. Live numbers come from HA state; history comes from HA's
// long-term statistics, which it keeps forever at hourly resolution.
// Totals are summed PER SENSOR from the per-cube daily counters, never from a summed template sensor:
// the two cubes reset their daily counters a moment apart, which turns a summed counter into a false
// jump at midnight (seen 2026-10-27).
import { hub } from "./ha";

export type Range = "today" | "week" | "month" | "year";
export type Circuit = { id: string; name: string; panel: "Left" | "Right"; watts: number; kwh: number };
export type Bucket = { t: number; label: string; load: number; solar: number; gridIn: number; gridOut: number; battIn: number; battOut: number; soc: number | null; has: boolean };
/** net = bought - sold. Under Dominion net metering a kWh sold cancels a kWh bought within the 12-month netting period, so net is what the bill sees. cost is an estimate from ENERGY_RATE_CENTS (null when no rate is set). */
export type Totals = { solar: number; load: number; gridIn: number; gridOut: number; battIn: number; battOut: number; self: number; selfPct: number | null; net: number; rateCents: number | null; cost: number | null };
export type Cube = { name: string; soc: number | null; solar: number; load: number; gridIn: number; gridOut: number; battIn: number; battOut: number };
export type Energy = {
  range: Range;
  /** Label of the first bucket with data, when the range starts before the records do. */
  since: string | null;
  /** Watts. grid > 0 = buying, < 0 = selling. battery > 0 = charging, < 0 = giving power back. */
  live: { solar: number; load: number; grid: number; battery: number; soc: number | null; cubes: number };
  totals: Totals;
  series: Bucket[];
  circuits: Circuit[];
  cubes: Cube[];
  updated: number;
};

const TZ = "America/New_York";
// The two EP Cubes are sensor.epcube_l_* and sensor.epcube_r_* (entity ids tidied 2026-10-25).
const LIVE = {
  solar: /^sensor\.epcube_[lr]_solarpower$/,
  load: /^sensor\.epcube_[lr]_total_load_power$/,
  grid: /^sensor\.epcube_[lr]_gridpower$/,
  // Reported in kW, positive = charging (checked against SOC history 2026-10-27). r_batterypower is a dead duplicate.
  battery: /^sensor\.epcube_(l_batterypower|r_battery_power)$/,
  soc: /^sensor\.epcube_[lr]_batterysoc$/,
};
// Daily kWh counters; statistics "change" handles the midnight reset (battery ones customised to total_increasing on the hub).
// Grid in/out: the per-cube counters double count whenever one cube exports while the other imports (the utility
// meter sees only the difference; Dominion's Sep-Oct 2026 bill proved it). The whole-home Riemann-sum helpers
// HOME_GRID are right and are preferred for every bucket where they have data (they start 2026-10-29).
const HOME_GRID = { gridIn: "sensor.home_grid_import_energy", gridOut: "sensor.home_grid_export_energy" } as const;
const COUNTERS = {
  solar: /^sensor\.epcube_[lr]_solarelectricity$/,
  load: /^sensor\.epcube_[lr]_total_load_energy$/,
  gridIn: /^sensor\.epcube_[lr]_gridelectricityfrom$/,
  gridOut: /^sensor\.epcube_[lr]_gridelectricityto$/,
  battIn: /^sensor\.epcube_[lr]_battery_daily_charge$/,
  battOut: /^sensor\.epcube_[lr]_battery_daily_discharge$/,
};
type CounterKey = keyof typeof COUNTERS;
const COUNTER_KEYS = Object.keys(COUNTERS) as CounterKey[];
const CIRCUIT_POWER = /^sensor\.span_panel(_2)?_(?!main_meter|feed_through|current_power|solar)(.+)_power$/;

function num(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function nyParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}
/** Midnight in New York for the given instant, as a Date. */
function startOfDayNY(d = new Date()) {
  const { y, m, d: day } = nyParts(d);
  let t = Date.UTC(y, m - 1, day, 5); // 05:00Z is midnight EST; adjust if DST
  const p = nyParts(new Date(t)); if (p.h !== 0) t -= p.h * 3600_000;
  return new Date(t);
}
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });
const LABEL: Record<Range, (t: number) => string> = {
  today: (t) => { const h = nyParts(new Date(t)).h; return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`; },
  week: (t) => fmt({ weekday: "short" }).format(t),
  month: (t) => fmt({ month: "numeric", day: "numeric" }).format(t),
  year: (t) => fmt({ month: "short" }).format(t),
};
/** The bucket start instants for a range: 24 hours, 7 or 30 days, or 12 months, ending now. */
function bucketStarts(range: Range): number[] {
  const mid = startOfDayNY();
  if (range === "today") return Array.from({ length: 24 }, (_, h) => mid.getTime() + h * 3600_000);
  if (range === "year") {
    const { y, m } = nyParts(mid);
    return Array.from({ length: 12 }, (_, i) => { let mm = m - 11 + i, yy = y; while (mm < 1) { mm += 12; yy--; } return startOfDayNY(new Date(Date.UTC(yy, mm - 1, 1, 12))).getTime(); });
  }
  const n = range === "week" ? 7 : 30;
  return Array.from({ length: n }, (_, i) => startOfDayNY(new Date(mid.getTime() - (n - 1 - i) * 86400_000 + 43200_000)).getTime());
}

const cache = new Map<string, { at: number; v: Energy }>();

export async function getEnergy(range: Range): Promise<Energy> {
  const hit = cache.get(range); if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const h = hub(); await h.connect(); await h.refreshRegistry();
  const ents = h.entities;
  const ids = Object.keys(ents);
  const pick = (re: RegExp) => ids.filter((i) => re.test(i));
  const sum = (re: RegExp, scale = 1) => pick(re).reduce((s, i) => s + num(ents[i].state) * scale, 0);
  const socIds = pick(LIVE.soc);
  const socOf = (list: string[]) => (list.length ? Math.round(list.reduce((s, i) => s + num(ents[i].state), 0) / list.length) : null);
  const live = {
    solar: Math.round(sum(LIVE.solar)), load: Math.round(sum(LIVE.load)), grid: Math.round(sum(LIVE.grid)), battery: Math.round(sum(LIVE.battery, 1000)),
    soc: socOf(socIds), cubes: pick(LIVE.load).length,
  };

  // Circuits: live watts from state, kWh from statistics on the matching consumed_energy counter (Wh).
  const circuits: Circuit[] = pick(CIRCUIT_POWER).map((i) => {
    const m = CIRCUIT_POWER.exec(i)!;
    const name = String(ents[i].attributes.friendly_name ?? i).replace(/^(Span Panel( 2)?|SPAN (Left|Right)) /, "").replace(/ Power$/, "");
    return { id: i.replace(/_power$/, "_consumed_energy"), name, panel: m[1] ? "Right" : "Left", watts: Math.round(num(ents[i].state)), kwh: 0 };
  });

  const counterIds = Object.fromEntries(COUNTER_KEYS.map((k) => [k, pick(COUNTERS[k])])) as Record<CounterKey, string[]>;
  const starts = bucketStarts(range);
  const period = range === "today" ? "hour" : range === "year" ? "month" : "day";
  type Row = { start: number; change?: number | null; mean?: number | null };
  const stats = await h.send<Record<string, Row[]>>({
    type: "recorder/statistics_during_period", start_time: new Date(starts[0]).toISOString(),
    statistic_ids: [...circuits.map((c) => c.id), ...Object.values(counterIds).flat(), ...Object.values(HOME_GRID), ...socIds], period, types: ["change", "mean"],
  });
  // A daily counter's reset shows as a negative change in older rows; a counter never really goes backwards.
  const change = (r: Row) => Math.max(0, r.change ?? 0);
  const total = (id: string) => (stats[id] ?? []).reduce((s, r) => s + change(r), 0);
  const bucketOf = (t: number) => { let b = -1; for (let i = 0; i < starts.length && starts[i] <= t; i++) b = i; return b; };

  for (const c of circuits) c.kwh = +(total(c.id) / 1000).toFixed(2);

  const series: Bucket[] = starts.map((t) => ({ t, label: LABEL[range](t), load: 0, solar: 0, gridIn: 0, gridOut: 0, battIn: 0, battOut: 0, soc: null, has: false }));
  // Buckets where the whole-home grid helpers have data use them instead of the per-cube grid counters.
  const homeGrid = new Set<number>();
  for (const k of ["gridIn", "gridOut"] as const) for (const r of stats[HOME_GRID[k]] ?? []) {
    const b = bucketOf(r.start); if (b < 0 || r.change == null) continue;
    series[b][k] += change(r); homeGrid.add(b); series[b].has = true;
  }
  for (const k of COUNTER_KEYS) for (const id of counterIds[k]) for (const r of stats[id] ?? []) {
    const b = bucketOf(r.start); if (b < 0) continue;
    if ((k === "gridIn" || k === "gridOut") && homeGrid.has(b)) continue;
    series[b][k] += change(r); if (r.change != null) series[b].has = true;
  }
  const socAcc = series.map(() => ({ s: 0, n: 0 }));
  for (const id of socIds) for (const r of stats[id] ?? []) { const b = bucketOf(r.start); if (b >= 0 && r.mean != null) { socAcc[b].s += r.mean; socAcc[b].n++; } }
  series.forEach((s, i) => { for (const k of COUNTER_KEYS) s[k] = +s[k].toFixed(2); s.soc = socAcc[i].n ? Math.round(socAcc[i].s / socAcc[i].n) : null; });

  const t = (k: CounterKey) => +series.reduce((s, b) => s + b[k], 0).toFixed(1);
  const load = t("load"), gridIn = t("gridIn");
  const self = +Math.max(0, load - gridIn).toFixed(1);
  const gridOut = t("gridOut"), net = +(gridIn - gridOut).toFixed(1);
  const rateCents = Number(process.env.ENERGY_RATE_CENTS) > 0 ? Number(process.env.ENERGY_RATE_CENTS) : null;
  const totals: Totals = { solar: t("solar"), load, gridIn, gridOut, battIn: t("battIn"), battOut: t("battOut"), self, selfPct: load > 0 ? Math.round((self / load) * 100) : null, net, rateCents, cost: rateCents ? +((net * rateCents) / 100).toFixed(2) : null };
  const first = series.findIndex((b) => b.has);
  const since = first > 0 ? series[first].label : null;

  // Per-cube detail by side. L feeds the left SPAN panel, R the right (David, 2026-10-25). Grid in/out here is
  // each cube's own flow, so the two can overlap (see HOME_GRID).
  const cubes: Cube[] = (["l", "r"] as const).filter((s) => counterIds.load.some((i) => i.includes(`epcube_${s}_`))).map((side) => {
    const of = (k: CounterKey) => +counterIds[k].filter((i) => i.includes(`epcube_${side}_`)).reduce((s, id) => s + total(id), 0).toFixed(1);
    return { name: side === "l" ? "Left cube" : "Right cube", soc: socOf(socIds.filter((i) => i.includes(`epcube_${side}_`))), solar: of("solar"), load: of("load"), gridIn: of("gridIn"), gridOut: of("gridOut"), battIn: of("battIn"), battOut: of("battOut") };
  });

  circuits.sort((a, b) => b.kwh - a.kwh || b.watts - a.watts);
  const v: Energy = { range, since, live, totals, series, circuits, cubes, updated: Date.now() };
  cache.set(range, { at: Date.now(), v });
  return v;
}

/** Short text for the model. */
export function describeEnergy(e: Energy) {
  const top = e.circuits.slice(0, 10).map((c) => `${c.name} (${c.panel}) ${c.kwh} kWh, ${c.watts} W now`).join("; ");
  const bat = e.live.battery > 50 ? `charging at ${e.live.battery} W` : e.live.battery < -50 ? `giving ${-e.live.battery} W` : "idle";
  return `Energy, ${e.range}${e.since ? ` (records start ${e.since})` : ""}: home used ${e.totals.load} kWh, of which ${e.totals.self} kWh (${e.totals.selfPct ?? "?"}%) came from our own sun and battery; sun made ${e.totals.solar} kWh; bought ${e.totals.gridIn} kWh from the grid, sold ${e.totals.gridOut} kWh, net ${e.totals.net} kWh from Dominion (net metering: sold cancels bought over the year)${e.totals.cost != null ? `, about $${e.totals.cost} at ${e.totals.rateCents} cents per kWh` : ""}; battery charged ${e.totals.battIn} kWh, gave back ${e.totals.battOut} kWh. ` +
    `Right now: sun ${e.live.solar} W, home using ${e.live.load} W, grid ${e.live.grid >= 0 ? "buying" : "selling"} ${Math.abs(e.live.grid)} W, battery ${e.live.soc ?? "?"}% ${bat}. Top circuits: ${top}.`;
}
