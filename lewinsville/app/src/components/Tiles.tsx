"use client";
import { useState } from "react";
import { NO_PARTIAL_COVERS, supportsColor, type Device } from "@/lib/house";

type Call = (body: Record<string, unknown>) => Promise<boolean>;
export const FLOOR_COLOR: Record<string, string> = {
  "First Floor": "var(--floor-first)", "Second Floor": "var(--floor-second)", Loft: "var(--floor-loft)", Basement: "var(--floor-basement)", Exterior: "var(--floor-exterior)",
};

// The colours a colour-capable light can be set to: the rainbow, fully saturated. White light is not a chip but
// the warmth slider below (warm to cool), which every tunable light has, colour-capable or not.
export const COLORS: { name: string; hs: [number, number]; swatch: string }[] = [
  { name: "Red", hs: [0, 100], swatch: "hsl(0 100% 50%)" }, { name: "Orange", hs: [28, 100], swatch: "hsl(28 100% 50%)" },
  { name: "Yellow", hs: [56, 100], swatch: "hsl(56 100% 50%)" }, { name: "Green", hs: [120, 100], swatch: "hsl(120 100% 40%)" },
  { name: "Blue", hs: [225, 100], swatch: "hsl(225 100% 50%)" }, { name: "Indigo", hs: [258, 100], swatch: "hsl(258 100% 45%)" },
  { name: "Violet", hs: [288, 100], swatch: "hsl(288 100% 50%)" },
];
export function supportsTemp(d: Device) { return ((d.attrs.supported_color_modes as string[] | undefined) ?? []).includes("color_temp"); }
const kelvinOf = (d: Device) => (d.state === "on" && d.attrs.color_mode === "color_temp" && typeof d.attrs.color_temp_kelvin === "number" ? d.attrs.color_temp_kelvin : null);
// Brightness sliders stop at 1 % and then every 10 %: eleven notches, 0 = 1 %.
const notch = (pct: number) => (pct < 6 ? 0 : Math.round(pct / 10));
const pctAt = (n: number) => (n === 0 ? 1 : n * 10);
/** The colour of white light at a temperature, for the warmth slider's track (Tanner Helland's fit to the black-body curve). */
function kelvinCss(k: number) {
  const t = k / 100, c = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return `rgb(${c(r)} ${c(g)} ${c(b)})`;
}
const pctOf = (d: Device) => (typeof d.attrs.brightness === "number" ? Math.round(d.attrs.brightness / 2.55) : 100);

/** The rainbow chip a light is showing now (nearest hue, when it is showing a colour and not white), or null. */
export function currentColor(d: Device): string | null {
  if (d.state !== "on" || d.attrs.color_mode === "color_temp" || !Array.isArray(d.attrs.hs_color)) return null;
  const [h, sat] = d.attrs.hs_color as number[];
  if (sat < 35) return null;
  let best: string | null = null, gap = 22;
  for (const c of COLORS) { const dh = Math.min(Math.abs(c.hs[0] - h), 360 - Math.abs(c.hs[0] - h)); if (dh < gap) { gap = dh; best = c.name; } }
  return best;
}
/** The chips. `selected` is the colour in use, which gets the ring; tapping another moves the ring there at once. */
export function ColorRow({ ids, call, selected = null }: { ids: string[]; call: Call; selected?: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);   // optimistic, until the light reports back
  const shown = picked ?? selected;
  return (
    <div className="chips mt-2 py-1" role="radiogroup" aria-label="Colour">
      {COLORS.map((c) => (
        <button key={c.name} className="chip" title={c.name} aria-label={c.name} role="radio" aria-checked={shown === c.name} style={{ background: c.swatch }}
          onPointerDown={() => setPicked(c.name)} onBlur={() => setPicked(null)}
          onClick={() => call({ entity_ids: ids, action: "set_color", hs: c.hs })} />
      ))}
    </div>
  );
}
/** White light, warm on the left to cool on the right, over the range these lights can do. */
export function Warmth({ lights, call, label }: { lights: Device[]; call: Call; label?: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const tun = lights.filter(supportsTemp);
  if (!tun.length) return null;
  const lo = Math.min(...tun.map((d) => Number(d.attrs.min_color_temp_kelvin) || 2000)), hi = Math.max(...tun.map((d) => Number(d.attrs.max_color_temp_kelvin) || 4000));
  const ks = tun.map(kelvinOf).filter((k): k is number => k != null);
  const now = ks.length ? Math.round(ks.reduce((x, y) => x + y, 0) / ks.length) : null;
  return (
    <div className="mt-2 flex items-center gap-3">
      {label && <span className="label w-20 shrink-0">{label}</span>}
      <input type="range" className="warmth" min={lo} max={hi} step={(hi - lo) / 10} value={drag ?? now ?? Math.round((lo + hi) / 2)} aria-label="Warm to cool white"
        style={{ opacity: now == null && drag == null ? 0.6 : 1, ["--track" as string]: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((f) => kelvinCss(lo + f * (hi - lo))).join(", ")})` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => { if (drag != null) { call({ entity_ids: tun.map((d) => d.id), action: "set_color_temp", value: drag }); setDrag(null); } }} />
    </div>
  );
}

export function LightTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const on = d.state === "on";
  const pct = pctOf(d);
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="tile" style={{ background: on ? `var(--on, ${color})` : "var(--card)", color: on ? "var(--on-ink)" : "var(--ink)" }}>
      <button className="flex w-full items-center justify-between gap-3" onClick={() => call({ entity_id: d.id, action: "toggle" })}>
        <span className="font-bold leading-tight">{d.name}</span>
        <span className="num text-xs font-bold opacity-70">{on ? `${drag ?? pct}%` : "off"}</span>
      </button>
      {on && (
        <input type="range" min={0} max={10} step={1} value={notch(drag ?? pct)} aria-label={`${d.name} brightness`}
          onChange={(e) => setDrag(pctAt(Number(e.target.value)))}
          onPointerUp={() => { if (drag != null) { call({ entity_id: d.id, action: "set_brightness", value: drag }); setDrag(null); } }}
          className="mt-2" />
      )}
      {on && <Warmth lights={[d]} call={call} />}
      {on && supportsColor(d) && <ColorRow ids={[d.id]} call={call} selected={currentColor(d)} />}
    </div>
  );
}

/** Several lights as one: brightness, warm-to-cool white, and the rainbow for those that take colour. The sliders
 *  act on the lights that are on, or on all of them when none is. */
export function GroupLights({ lights, call, title }: { lights: Device[]; call: Call; title: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const lit = lights.filter((d) => d.state === "on");
  const target = lit.length ? lit : lights;
  const dim = target.filter((d) => ((d.attrs.supported_color_modes as string[] | undefined) ?? []).some((m) => m !== "onoff"));
  const colour = target.filter(supportsColor);
  if (dim.length < 2) return null;
  const pct = lit.length ? Math.round(lit.reduce((x, d) => x + pctOf(d), 0) / lit.length) : 0;
  const shades = new Set(colour.map(currentColor));
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">{title}</h2>
        <span className="label">{lit.length} of {lights.length} on</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="label w-20 shrink-0">Brightness</span>
        <input type="range" min={0} max={10} step={1} value={notch(drag ?? pct)} aria-label={`${title} brightness`} onChange={(e) => setDrag(pctAt(Number(e.target.value)))}
          onPointerUp={() => { if (drag != null) { call({ entity_ids: dim.map((d) => d.id), action: "set_brightness", value: drag }); setDrag(null); } }} />
        <span className="num w-9 text-right text-xs font-bold text-ink-soft">{drag ?? pct}%</span>
      </div>
      <Warmth lights={target} call={call} label="Warmth" />
      {colour.length > 0 && <ColorRow ids={colour.map((d) => d.id)} call={call} selected={shades.size === 1 ? [...shades][0] : null} />}
    </section>
  );
}

export function FanTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const on = d.state === "on";
  const pct = typeof d.attrs.percentage === "number" ? Math.round(d.attrs.percentage) : 0;
  const presets = (d.attrs.preset_modes as string[] | undefined) ?? [];
  const preset = typeof d.attrs.preset_mode === "string" ? d.attrs.preset_mode : null;
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="tile" style={{ background: on ? `var(--on, ${color})` : "var(--card)", color: on ? "var(--on-ink)" : "var(--ink)" }}>
      <button className="flex w-full items-center justify-between gap-3" onClick={() => call({ entity_id: d.id, action: "toggle" })}>
        <span className="font-bold leading-tight">{d.name}</span>
        <span className="num text-xs font-bold opacity-70">{!on ? "off" : preset ? preset : `${drag ?? pct}%`}</span>
      </button>
      {on && (
        <input type="range" min={0} max={100} value={drag ?? pct} aria-label={`${d.name} speed`}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag != null) { call({ entity_id: d.id, action: drag === 0 ? "turn_off" : "set_percentage", value: drag }); setDrag(null); } }}
          className="mt-2" />
      )}
      {on && presets.length > 0 && (
        <div className="mt-2 flex gap-2">
          {presets.map((p) => (
            <button key={p} className="rounded-full px-3 py-1 text-xs font-bold capitalize" style={{ background: preset === p ? "var(--ink)" : "var(--cream)", color: preset === p ? "var(--cream)" : "var(--ink)" }}
              onClick={() => call(preset === p ? { entity_id: d.id, action: "set_percentage", value: pct || 50 } : { entity_id: d.id, action: "set_preset", preset: p })}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SwitchTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const on = d.state === "on";
  return (
    <button className="tile flex w-full items-center justify-between" style={{ background: on ? `var(--on, ${color})` : "var(--card)", color: on ? "var(--on-ink)" : "var(--ink)" }}
      onClick={() => call({ entity_id: d.id, action: "toggle" })}>
      <span className="font-bold">{d.name}</span><span className="text-xs font-bold opacity-70">{on ? "on" : "off"}</span>
    </button>
  );
}

export function CoverTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const pos = typeof d.attrs.current_position === "number" ? Math.round(d.attrs.current_position) : d.state === "open" ? 100 : d.state === "closed" ? 0 : null;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? pos;
  const open = (shown ?? 0) > 0;
  const label = shown == null ? d.state : shown === 0 ? "closed" : shown === 100 ? "open" : `${shown}% open`;
  const wholeOnly = NO_PARTIAL_COVERS.has(d.id);
  return (
    <div className="tile" style={{ background: open ? `var(--on, ${color})` : "var(--card)", color: open ? "var(--on-ink)" : "var(--ink)" }}>
      <button className="flex w-full items-center justify-between gap-3" onClick={() => call({ entity_id: d.id, action: open ? "close" : "open" })}>
        <span className="font-bold leading-tight">{d.name}</span>
        <span className="num text-xs font-bold opacity-70">{label}</span>
      </button>
      {wholeOnly ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm font-bold">
          <button className="rounded-xl py-2" style={{ background: "var(--cream)", color: "var(--ink)" }} onClick={() => call({ entity_id: d.id, action: "open" })}>Open</button>
          <button className="rounded-xl py-2" style={{ background: "var(--cream)", color: "var(--ink)" }} onClick={() => call({ entity_id: d.id, action: "close" })}>Close</button>
        </div>
      ) : (
        <input type="range" min={0} max={100} step={10} value={shown ?? 0} aria-label={`${d.name} position`}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag != null) { call({ entity_id: d.id, action: drag === 0 ? "close" : drag === 100 ? "open" : "set_position", value: drag }); setDrag(null); } }}
          className="mt-2" />
      )}
    </div>
  );
}

export function ClimateCard({ d, call, big = false }: { d: Device; call: Call; big?: boolean }) {
  const cur = d.attrs.current_temperature as number | undefined;
  const set = d.attrs.temperature as number | undefined;
  const action = (d.attrs.hvac_action as string) ?? "idle";
  const hum = d.attrs.current_humidity as number | undefined;
  const modes = (d.attrs.hvac_modes as string[] | undefined)?.filter((m) => ["off", "cool", "heat", "heat_cool", "fan_only"].includes(m)) ?? [];
  const tint = action === "cooling" ? "var(--sky)" : action === "heating" ? "var(--saffron)" : "var(--ink-soft)";
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold">{d.room}</div>
          <div className="label" style={{ color: tint }}>{d.state === "off" ? "off" : action}{hum != null ? ` · ${hum}% rh` : ""}</div>
        </div>
        <div className="display text-4xl font-extrabold">{cur ?? "–"}°</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button className="h-12 w-12 rounded-full bg-indigo/15 text-2xl font-bold" onClick={() => set != null && call({ entity_id: d.id, action: "set_temperature", value: set - 1 })}>−</button>
        <div className="text-center"><div className="label">set to</div><div className="display text-3xl font-extrabold">{set ?? "–"}°</div></div>
        <button className="h-12 w-12 rounded-full bg-saffron/20 text-2xl font-bold" onClick={() => set != null && call({ entity_id: d.id, action: "set_temperature", value: set + 1 })}>+</button>
      </div>
      {(big || modes.length) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {modes.map((m) => (
            <button key={m} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: d.state === m ? "var(--ink)" : "var(--cream)", color: d.state === m ? "var(--cream)" : "var(--ink)" }}
              onClick={() => call({ entity_id: d.id, action: "set_hvac_mode", hvac_mode: m })}>{m.replace("_", " ")}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MediaCard({ d, call }: { d: Device; call: Call }) {
  const playing = d.state === "playing";
  const title = (d.attrs.media_title as string) || (d.state === "off" ? "Off" : d.state);
  const artist = d.attrs.media_artist as string | undefined;
  const vol = typeof d.attrs.volume_level === "number" ? Math.round(d.attrs.volume_level * 100) : null;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><div className="truncate font-bold">{d.name}</div><div className="truncate text-sm text-ink-soft">{title}{artist ? ` · ${artist}` : ""}</div></div>
        <button className="h-12 w-12 shrink-0 rounded-full text-xl font-bold" style={{ background: playing ? "var(--rani)" : "var(--peacock)", color: "white" }}
          onClick={() => call({ entity_id: d.id, action: playing ? "pause" : "play" })}>{playing ? "❚❚" : "▶"}</button>
      </div>
      {vol != null && <input type="range" min={0} max={100} defaultValue={vol} className="mt-3" aria-label="volume"
        onPointerUp={(e) => call({ entity_id: d.id, action: "volume_set", value: Number((e.target as HTMLInputElement).value) / 100 })} />}
    </div>
  );
}

export function DeviceTile(props: { d: Device; call: Call; color: string }) {
  switch (props.d.domain) {
    case "light": return <LightTile {...props} />;
    case "fan": return <FanTile {...props} />;
    case "cover": return <CoverTile {...props} />;
    case "climate": return <ClimateCard d={props.d} call={props.call} />;
    case "media_player": return <MediaCard d={props.d} call={props.call} />;
    default: return <SwitchTile {...props} />;
  }
}
