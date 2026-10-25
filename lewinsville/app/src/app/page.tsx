"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useHouse } from "@/components/useHouse";
import { ClimateCard, DeviceTile, FLOOR_COLOR, MediaCard } from "@/components/Tiles";
import { Chat } from "@/components/Chat";
import { Entertain } from "@/components/Entertain";

const TABS = [["home", "Home", "⌂"], ["entertain", "Lounge", "♪"], ["rooms", "Rooms", "☼"], ["climate", "Climate", "°"], ["talk", "Talk", "✦"]] as const;
type Theme = "festival" | "slate";
function readSavedTheme(): Theme | null { try { const t = localStorage.getItem("lhh-theme"); return t === "slate" || t === "festival" ? t : null; } catch { return null; } }
function subscribeTheme(cb: () => void) { window.addEventListener("lhh-theme", cb); window.addEventListener("storage", cb); return () => { window.removeEventListener("lhh-theme", cb); window.removeEventListener("storage", cb); }; }
type Tab = (typeof TABS)[number][0];

export default function Page() {
  const { house, me, error, call } = useHouse();
  const [tab, setTab] = useState<Tab>("home");
  const [room, setRoom] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // The look: the person's default from the server, overridden by whatever they last picked on this device.
  const saved = useSyncExternalStore(subscribeTheme, readSavedTheme, () => null);
  const theme: Theme | null = saved ?? me?.theme ?? null;
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "slate" ? "#f2f3f5" : "#ffb300");
  }, [theme]);
  const setTheme = (t: Theme) => { try { localStorage.setItem("lhh-theme", t); } catch {} window.dispatchEvent(new Event("lhh-theme")); };
  const confirmThen = (key: string, fn: () => void) => {
    if (armed === key) { setArmed(null); fn(); return; }
    setArmed(key); setTimeout(() => setArmed((a) => (a === key ? null : a)), 3000);
  };

  const all = useMemo(() => house?.rooms.flatMap((r) => r.devices) ?? [], [house]);
  const lightsOn = all.filter((d) => d.domain === "light" && d.state === "on");
  const covers = all.filter((d) => d.domain === "cover");
  const climates = all.filter((d) => d.domain === "climate");
  const media = all.filter((d) => d.domain === "media_player" && d.state === "playing");

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-28 pt-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-sm font-bold uppercase tracking-widest text-ink-soft">Lewinsville</div>
          <h1 className="display text-3xl font-extrabold">{me?.greeting ?? "Hello"}</h1>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="rounded-full bg-saffron/20 px-3 py-1 text-xs font-bold text-saffron">{error}</span>}
          <button className="card h-9 w-9 text-base" aria-label="Switch look" title={theme === "slate" ? "Switch to colour" : "Switch to quiet"} onClick={() => setTheme(theme === "slate" ? "festival" : "slate")}>{theme === "slate" ? "◑" : "◐"}</button>
        </div>
      </header>

      {tab === "home" && house && (
        <div className="space-y-5">
          <section>
            <div className="grid grid-cols-2 gap-3">
              {([["welcome", "Welcome"], ["day", "Day"], ["night", "Night"], ["away", "Away"]] as const).map(([k, l]) => (
                <button key={k} className="scene jaali h-24 text-2xl font-extrabold text-white shadow-lg" style={{ background: `var(--scene-${k})`, outline: armed === k ? "4px solid var(--ink)" : "none" }} onClick={() => confirmThen(k, () => call({ scene: k }))}>{armed === k ? "Tap again" : l}</button>
              ))}
            </div>
          </section>
          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-extrabold">Shades</h2><span className="text-xs font-bold opacity-60">{covers.length} in the house</span></div>
            <div className="grid grid-cols-3 gap-2 font-bold">
              <button className="rounded-2xl bg-sky/25 py-3" onClick={() => confirmThen("open", () => call({ entity_ids: covers.map((c) => c.id), action: "open" }))}>{armed === "open" ? "Tap again" : "Open all"}</button>
              <button className="rounded-2xl bg-ink/10 py-3" onClick={() => confirmThen("half", () => call({ entity_ids: covers.filter((c) => c.id !== "cover.living_room_shade").map((c) => c.id), action: "set_position", value: 50 }))}>{armed === "half" ? "Tap again" : "Halfway"}</button>
              <button className="rounded-2xl bg-indigo/25 py-3" onClick={() => confirmThen("close", () => call({ entity_ids: covers.map((c) => c.id), action: "close" }))}>{armed === "close" ? "Tap again" : "Close all"}</button>
            </div>
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-extrabold">Lights on</h2>
              {lightsOn.length > 0 && <button className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-cream" onClick={() => confirmThen("alloff", () => call({ entity_ids: lightsOn.map((l) => l.id), action: "turn_off" }))}>{armed === "alloff" ? "Tap again" : "Turn all off"}</button>}</div>
            {lightsOn.length === 0 ? <div className="card p-4 text-sm opacity-70">Everything is off.</div> : (
              <div className="grid grid-cols-2 gap-2">{lightsOn.map((d) => <DeviceTile key={d.id} d={{ ...d, name: `${d.room} · ${d.name}` }} call={call} color={FLOOR_COLOR[d.floor]} />)}</div>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-lg font-extrabold">Temperature</h2>
            <div className="grid grid-cols-2 gap-2">
              {climates.map((d) => (
                <button key={d.id} className="card p-3 text-left" onClick={() => setTab("climate")}>
                  <div className="text-xs font-bold uppercase opacity-60">{d.room}</div>
                  <div className="display text-3xl font-extrabold">{String(d.attrs.current_temperature ?? "–")}°</div>
                  <div className="text-xs opacity-60">{d.state === "off" ? "off" : `${d.attrs.hvac_action ?? "idle"} · set ${d.attrs.temperature}°`}</div>
                </button>
              ))}
            </div>
          </section>
          {media.length > 0 && <section><h2 className="mb-2 text-lg font-extrabold">Playing</h2><div className="space-y-2">{media.map((d) => <MediaCard key={d.id} d={d} call={call} />)}</div></section>}
        </div>
      )}

      {tab === "rooms" && house && (
        <div className="space-y-5">
          {room === null ? house.floors.map((f) => (
            <section key={f}>
              <h2 className="mb-2 text-lg font-extrabold" style={{ color: FLOOR_COLOR[f] }}>{f}</h2>
              <div className="grid grid-cols-2 gap-2">
                {house.rooms.filter((r) => r.floor === f).map((r) => {
                  const on = r.devices.filter((d) => d.domain === "light" && d.state === "on").length;
                  return (
                    <button key={r.id} className="tile card flex h-20 flex-col justify-between border-l-8" style={{ borderColor: FLOOR_COLOR[f] }} onClick={() => setRoom(r.id)}>
                      <span className="font-extrabold leading-tight">{r.name}</span>
                      <span className="text-xs font-bold opacity-60">{on ? `${on} light${on > 1 ? "s" : ""} on` : `${r.devices.length} thing${r.devices.length === 1 ? "" : "s"}`}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )) : (() => {
            const r = house.rooms.find((x) => x.id === room)!;
            const lights = r.devices.filter((d) => d.domain === "light");
            return (
              <section>
                <button className="mb-3 text-sm font-bold text-ink-soft" onClick={() => setRoom(null)}>‹ All rooms</button>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="display text-2xl font-extrabold">{r.name}</h2>
                  {lights.length > 0 && <div className="flex gap-2 text-xs font-bold">
                    <button className="rounded-full px-3 py-1.5 text-white" style={{ background: FLOOR_COLOR[r.floor] }} onClick={() => call({ entity_ids: lights.map((l) => l.id), action: "turn_on" })}>All on</button>
                    <button className="rounded-full bg-ink px-3 py-1.5 text-cream" onClick={() => call({ entity_ids: lights.map((l) => l.id), action: "turn_off" })}>All off</button>
                  </div>}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{r.devices.map((d) => <DeviceTile key={d.id} d={d} call={call} color={FLOOR_COLOR[r.floor]} />)}</div>
              </section>
            );
          })()}
        </div>
      )}

      {tab === "entertain" && house && <Entertain house={house} call={call} />}

      {tab === "climate" && house && <div className="space-y-3">{climates.map((d) => <ClimateCard key={d.id} d={d} call={call} big />)}</div>}

      {tab === "talk" && <div className="h-[calc(100dvh-13rem)]"><Chat enabled={Boolean(me?.chat)} name={me?.name ?? "there"} /></div>}

      {!house && !error && <div className="card p-6 text-center opacity-70">Waking the house…</div>}

      <nav className="fixed inset-x-0 bottom-0 mx-auto max-w-xl px-4" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="card flex justify-around p-1.5">
          {TABS.map(([k, l, i]) => (
            <button key={k} onClick={() => { setTab(k); if (k === "rooms") setRoom(null); }} className="flex flex-1 flex-col items-center rounded-2xl py-2 text-xs font-bold"
              style={{ background: tab === k ? "var(--ink)" : "transparent", color: tab === k ? "var(--cream)" : "var(--ink)" }}>
              <span className="text-lg leading-none">{i}</span>{l}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
