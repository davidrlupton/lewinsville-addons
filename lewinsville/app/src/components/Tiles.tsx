"use client";
import { useState } from "react";
import { NO_PARTIAL_COVERS, supportsColor, type Device } from "@/lib/house";

type Call = (body: Record<string, unknown>) => Promise<boolean>;
export const FLOOR_COLOR: Record<string, string> = {
  "First Floor": "var(--floor-first)", "Second Floor": "var(--floor-second)", Loft: "var(--floor-loft)", Basement: "var(--floor-basement)", Exterior: "var(--floor-exterior)",
};

// Colour presets for the accent lights. hs = [hue, saturation]; k = kelvin for white light.
export const COLORS: { name: string; hs?: [number, number]; k?: number; swatch: string }[] = [
  { name: "Candle", k: 2000, swatch: "#ffb35c" }, { name: "Warm", k: 2700, swatch: "#ffd1a3" }, { name: "Bright", k: 4000, swatch: "#fff1e0" },
  { name: "Amber", hs: [38, 100], swatch: "hsl(38 100% 55%)" }, { name: "Coral", hs: [12, 80], swatch: "hsl(12 80% 58%)" }, { name: "Rose", hs: [335, 70], swatch: "hsl(335 70% 60%)" },
  { name: "Violet", hs: [272, 70], swatch: "hsl(272 70% 60%)" }, { name: "Blue", hs: [220, 85], swatch: "hsl(220 85% 58%)" }, { name: "Teal", hs: [176, 80], swatch: "hsl(176 80% 42%)" }, { name: "Green", hs: [120, 65], swatch: "hsl(120 65% 45%)" },
];
export function ColorRow({ ids, call, whiteOnly = false }: { ids: string[]; call: Call; whiteOnly?: boolean }) {
  return (
    <div className="scroll-x mt-2 flex gap-2 py-1">
      {COLORS.filter((c) => !whiteOnly || c.k).map((c) => (
        <button key={c.name} className="chip" title={c.name} aria-label={c.name} style={{ background: c.swatch }}
          onClick={() => call(c.hs ? { entity_ids: ids, action: "set_color", hs: c.hs } : { entity_ids: ids, action: "set_color_temp", value: c.k })} />
      ))}
    </div>
  );
}

export function LightTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const on = d.state === "on";
  const pct = typeof d.attrs.brightness === "number" ? Math.round(d.attrs.brightness / 2.55) : 100;
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="tile" style={{ background: on ? `var(--on, ${color})` : "var(--card)", color: on ? "var(--on-ink)" : "var(--ink)" }}>
      <button className="flex w-full items-center justify-between gap-3" onClick={() => call({ entity_id: d.id, action: "toggle" })}>
        <span className="font-bold leading-tight">{d.name}</span>
        <span className="text-xs font-bold opacity-70">{on ? `${drag ?? pct}%` : "off"}</span>
      </button>
      {on && (
        <input type="range" min={1} max={100} value={drag ?? pct} aria-label={`${d.name} brightness`}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag != null) { call({ entity_id: d.id, action: "set_brightness", value: drag }); setDrag(null); } }}
          className="mt-2" />
      )}
      {on && supportsColor(d) && <ColorRow ids={[d.id]} call={call} />}
    </div>
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
        <span className="text-xs font-bold opacity-70">{!on ? "off" : preset ? preset : `${drag ?? pct}%`}</span>
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
        <span className="text-xs font-bold opacity-70">{label}</span>
      </button>
      {wholeOnly ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm font-bold">
          <button className="rounded-xl py-2" style={{ background: "var(--cream)", color: "var(--ink)" }} onClick={() => call({ entity_id: d.id, action: "open" })}>Open</button>
          <button className="rounded-xl py-2" style={{ background: "var(--cream)", color: "var(--ink)" }} onClick={() => call({ entity_id: d.id, action: "close" })}>Close</button>
        </div>
      ) : (
        <input type="range" min={0} max={100} value={shown ?? 0} aria-label={`${d.name} position`}
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
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: tint }}>{d.state === "off" ? "off" : action}{hum != null ? ` · ${hum}% rh` : ""}</div>
        </div>
        <div className="display text-4xl font-extrabold">{cur ?? "–"}°</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button className="h-12 w-12 rounded-full bg-indigo/15 text-2xl font-bold" onClick={() => set != null && call({ entity_id: d.id, action: "set_temperature", value: set - 1 })}>−</button>
        <div className="text-center"><div className="text-xs font-bold uppercase opacity-60">set to</div><div className="display text-3xl font-extrabold">{set ?? "–"}°</div></div>
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
        <div className="min-w-0"><div className="truncate font-bold">{d.name}</div><div className="truncate text-sm opacity-70">{title}{artist ? ` · ${artist}` : ""}</div></div>
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
