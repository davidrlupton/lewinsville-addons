"use client";
import { useState } from "react";
import { ENTERTAIN, supportsColor, type House } from "@/lib/house";
import { DeviceTile, FLOOR_COLOR, GroupLights, MediaCard } from "@/components/Tiles";

type Call = (body: Record<string, unknown>) => Promise<boolean>;

/** The open-plan first floor on one screen: moods, the accent colours, every light by room, the shades, the screen and sound. */
export function Entertain({ house, call }: { house: House; call: Call }) {
  const rooms = ENTERTAIN.rooms.map((n) => house.rooms.find((r) => r.name === n)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const devices = rooms.flatMap((r) => r.devices);
  const lights = devices.filter((d) => d.domain === "light");
  const accents = lights.filter(supportsColor);
  const covers = devices.filter((d) => d.domain === "cover");
  const media = devices.filter((d) => d.domain === "media_player");
  const [armed, setArmed] = useState<string | null>(null);
  const confirmThen = (key: string, fn: () => void) => {
    if (armed === key) { setArmed(null); fn(); return; }
    setArmed(key); setTimeout(() => setArmed((a) => (a === key ? null : a)), 3000);
  };

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Moods</h2>
          <span className="label">As on the keypads</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(ENTERTAIN.moods).map(([k, m], i) => (
            <button key={k} className="scene jaali h-16 text-sm font-extrabold text-white shadow-lg" style={{ background: `var(--scene-${["welcome", "day", "night", "away"][i % 4]})` }}
              onClick={() => call({ mood: k })}>{m.label}</button>
          ))}
        </div>
      </section>

      {accents.length > 0 && <GroupLights lights={accents} call={call} title="Accent colour" />}
      <GroupLights lights={lights} call={call} title="Every light here" />
      <button className="w-full rounded-2xl bg-ink/10 py-3 text-sm font-bold" onClick={() => confirmThen("off", () => call({ entity_ids: lights.map((l) => l.id), action: "turn_off" }))}>{armed === "off" ? "Tap again" : "All off"}</button>

      {rooms.map((r) => {
        const rl = r.devices.filter((d) => d.domain === "light");
        if (!rl.length) return null;
        return (
          <section key={r.id}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-extrabold">{r.name}</h2>
              <div className="flex gap-2 text-xs font-bold">
                <button className="rounded-full px-3 py-1.5 text-white" style={{ background: FLOOR_COLOR[r.floor] }} onClick={() => call({ entity_ids: rl.map((l) => l.id), action: "turn_on" })}>All on</button>
                <button className="rounded-full bg-ink px-3 py-1.5 text-cream" onClick={() => call({ entity_ids: rl.map((l) => l.id), action: "turn_off" })}>All off</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{rl.map((d) => <DeviceTile key={d.id} d={d} call={call} color={FLOOR_COLOR[r.floor]} />)}</div>
          </section>
        );
      })}

      {covers.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-extrabold">Shades</h2><span className="label">{covers.length} down here</span></div>
          <div className="grid grid-cols-2 gap-2 font-bold">
            <button className="rounded-2xl bg-sky/25 py-3" onClick={() => call({ entity_ids: covers.map((c) => c.id), action: "open" })}>Open all</button>
            <button className="rounded-2xl bg-indigo/25 py-3" onClick={() => call({ entity_ids: covers.map((c) => c.id), action: "close" })}>Close all</button>
          </div>
        </section>
      )}

      {media.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-extrabold">Screen &amp; sound</h2>
          <div className="space-y-2">{media.map((d) => <MediaCard key={d.id} d={d} call={call} />)}</div>
        </section>
      )}
    </div>
  );
}
