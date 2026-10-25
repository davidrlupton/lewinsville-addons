"use client";
import { useState } from "react";
import type { Device } from "@/lib/house";

type Call = (body: Record<string, unknown>) => Promise<boolean>;
export const FLOOR_COLOR: Record<string, string> = {
  "First Floor": "var(--marigold)", "Second Floor": "var(--rani)", Loft: "var(--indigo)", Basement: "var(--peacock)", Exterior: "var(--saffron)",
};

export function LightTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const on = d.state === "on";
  const pct = typeof d.attrs.brightness === "number" ? Math.round(d.attrs.brightness / 2.55) : 100;
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="tile" style={{ background: on ? color : "var(--card)", color: on ? "#1c1240" : "var(--ink)" }}>
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
    </div>
  );
}

export function SwitchTile({ d, call, color }: { d: Device; call: Call; color: string }) {
  const on = d.state === "on";
  return (
    <button className="tile flex w-full items-center justify-between" style={{ background: on ? color : "var(--card)", color: on ? "#1c1240" : "var(--ink)" }}
      onClick={() => call({ entity_id: d.id, action: "toggle" })}>
      <span className="font-bold">{d.name}</span><span className="text-xs font-bold opacity-70">{on ? "on" : "off"}</span>
    </button>
  );
}

export function CoverTile({ d, call }: { d: Device; call: Call }) {
  const pos = d.attrs.current_position as number | undefined;
  const label = pos == null ? d.state : pos === 0 ? "closed" : pos === 100 ? "open" : `${pos}% open`;
  return (
    <div className="tile bg-card">
      <div className="flex items-center justify-between"><span className="font-bold">{d.name}</span><span className="text-xs font-bold opacity-60">{label}</span></div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm font-bold">
        <button className="rounded-xl bg-sky/20 py-2" onClick={() => call({ entity_id: d.id, action: "open" })}>Open</button>
        <button className="rounded-xl bg-ink/10 py-2" onClick={() => call({ entity_id: d.id, action: "set_position", value: 50 })}>Half</button>
        <button className="rounded-xl bg-indigo/20 py-2" onClick={() => call({ entity_id: d.id, action: "close" })}>Close</button>
      </div>
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
    case "cover": return <CoverTile d={props.d} call={props.call} />;
    case "climate": return <ClimateCard d={props.d} call={props.call} />;
    case "media_player": return <MediaCard d={props.d} call={props.call} />;
    default: return <SwitchTile {...props} />;
  }
}
