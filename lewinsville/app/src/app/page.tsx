"use client";
import type { House, Room } from "@/lib/house";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useHouse } from "@/components/useHouse";
import { ClimateCard, DeviceTile, FLOOR_COLOR, MediaCard } from "@/components/Tiles";
import { Icon, type IconName } from "@/components/Icons";
import { Chat } from "@/components/Chat";
import { Entertain } from "@/components/Entertain";
import { Energy } from "@/components/Energy";
import { Sounds } from "@/components/Sounds";
import { Log } from "@/components/Log";

const TABS: readonly (readonly [string, string, IconName])[] = [["home", "Home", "home"], ["entertain", "Lounge", "lounge"], ["rooms", "Rooms", "rooms"], ["energy", "Energy", "energy"], ["climate", "Climate", "climate"], ["talk", "Talk", "talk"]];
type Tab = (typeof TABS)[number][0];
type Theme = "festival" | "slate";
function readSavedTheme(): Theme | null { try { const t = localStorage.getItem("lhh-theme"); return t === "slate" || t === "festival" ? t : null; } catch { return null; } }
function subscribeTheme(cb: () => void) { window.addEventListener("lhh-theme", cb); window.addEventListener("storage", cb); return () => { window.removeEventListener("lhh-theme", cb); window.removeEventListener("storage", cb); }; }
// The status bar matches the page background of the look in use, one colour per scheme.
const TOP: Record<Theme, [string, string]> = { festival: ["#fff6e9", "#15102b"], slate: ["#f2f3f5", "#0e1013"] };

// The whole primary suite as one room, pinned at the top of Rooms (David, 2026-10-31).
const SUITE = ["primary_bedroom", "primary_bath", "primary_closet", "primary_water_closet"];
function suite(house: House): Room {
  const parts = house.rooms.filter((r) => SUITE.includes(r.id));
  const label = (r: Room) => r.name.replace(/^Primary ?/, "") || "Bedroom";
  return { id: "primary_suite", name: "Primary Suite", floor: "Second Floor", devices: parts.flatMap((r) => r.devices.map((d) => ({ ...d, name: `${label(r)} · ${d.name}` }))) };
}

export default function Page() {
  const { house, me, error, call } = useHouse();
  const [tab, setTab] = useState<Tab>("home");
  const [room, setRoom] = useState<string | null>(null);
  const [pop, setPop] = useState(false);    // the list slides in from the left only when returning from a room
  const goRoom = (id: string) => { setPop(false); setRoom(id); };
  const backToRooms = () => { setPop(true); setRoom(null); };
  const [armed, setArmed] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  // The look: the person's default from the server, overridden by whatever they last picked on this device.
  const saved = useSyncExternalStore(subscribeTheme, readSavedTheme, () => null);
  const theme: Theme | null = saved ?? me?.theme ?? null;
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", TOP[theme][m.media.includes("dark") ? 1 : 0]));
  }, [theme]);
  const setTheme = (t: Theme) => { try { localStorage.setItem("lhh-theme", t); } catch {} window.dispatchEvent(new Event("lhh-theme")); };
  const confirmThen = (key: string, fn: () => void) => {
    if (armed === key) { setArmed(null); fn(); return; }
    setArmed(key); setTimeout(() => setArmed((a) => (a === key ? null : a)), 3000);
  };
  // Problems surface as a toast above the tab bar; a lost connection stays up until it is back.
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!error || error === "Reconnecting…") return;
    const t = setTimeout(() => setDismissed(error), 3500);
    return () => clearTimeout(t);
  }, [error]);
  const toast = error && dismissed !== error ? error : null;

  const all = useMemo(() => house?.rooms.flatMap((r) => r.devices) ?? [], [house]);
  const lightsOn = all.filter((d) => d.domain === "light" && d.state === "on");
  const covers = all.filter((d) => d.domain === "cover");
  const climates = all.filter((d) => d.domain === "climate");
  const media = all.filter((d) => d.domain === "media_player" && d.state === "playing");
  const tabIndex = Math.max(0, TABS.findIndex(([k]) => k === tab));
  const ring = (key: string) => (armed === key ? { boxShadow: "0 0 0 3px var(--ink)" } : undefined);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-32 pt-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="label">Lewinsville</div>
          <h1 className="display text-[26px] font-extrabold sm:text-3xl">{me?.greeting ?? "Hello"}</h1>
        </div>
        <button className="card flex h-10 w-10 items-center justify-center text-base" aria-label="Switch look" title={theme === "slate" ? "Switch to colour" : "Switch to quiet"} onClick={() => setTheme(theme === "slate" ? "festival" : "slate")}>{theme === "slate" ? "◑" : "◐"}</button>
      </header>

      {tab === "home" && house && (
        <div key="home" className="enter space-y-5">
          <section>
            <div className="grid grid-cols-2 gap-3">
              {([["welcome", "Welcome"], ["day", "Day"], ["night", "Night"], ["away", "Away"]] as const).map(([k, l]) => (
                <button key={k} className="scene jaali h-24 text-2xl font-extrabold text-white shadow-lg" style={{ background: `var(--scene-${k})`, ...ring(k) }} onClick={() => confirmThen(k, () => call({ scene: k }))}>{armed === k ? "Tap again" : l}</button>
              ))}
            </div>
          </section>
          <section className="card p-4">
            <div className="mb-2 flex items-baseline justify-between"><h2 className="text-lg font-extrabold">Shades</h2><span className="label">{covers.length} in the house</span></div>
            <div className="grid grid-cols-3 gap-2 font-bold">
              <button className="rounded-2xl bg-sky/25 py-3" style={ring("open")} onClick={() => confirmThen("open", () => call({ entity_ids: covers.map((c) => c.id), action: "open" }))}>{armed === "open" ? "Tap again" : "Open all"}</button>
              <button className="rounded-2xl bg-ink/10 py-3" style={ring("half")} onClick={() => confirmThen("half", () => call({ entity_ids: covers.filter((c) => c.id !== "cover.living_room_shade").map((c) => c.id), action: "set_position", value: 50 }))}>{armed === "half" ? "Tap again" : "Halfway"}</button>
              <button className="rounded-2xl bg-indigo/25 py-3" style={ring("close")} onClick={() => confirmThen("close", () => call({ entity_ids: covers.map((c) => c.id), action: "close" }))}>{armed === "close" ? "Tap again" : "Close all"}</button>
            </div>
          </section>
          <section>
            <div className="mb-2 flex items-baseline justify-between"><h2 className="text-lg font-extrabold">Lights on</h2>
              {lightsOn.length > 0 && <button className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-cream" style={ring("alloff")} onClick={() => confirmThen("alloff", () => call({ entity_ids: lightsOn.map((l) => l.id), action: "turn_off" }))}>{armed === "alloff" ? "Tap again" : "Turn all off"}</button>}</div>
            {lightsOn.length === 0 ? <div className="card p-4 text-sm text-ink-soft">Everything is off.</div> : (
              <div className="stagger grid grid-cols-2 gap-2">{lightsOn.map((d) => <DeviceTile key={d.id} d={{ ...d, name: `${d.room} · ${d.name}` }} call={call} color={FLOOR_COLOR[d.floor]} />)}</div>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-lg font-extrabold">Temperature</h2>
            <div className="grid grid-cols-2 gap-2">
              {climates.map((d) => (
                <button key={d.id} className="card p-3 text-left" onClick={() => setTab("climate")}>
                  <div className="label">{d.room}</div>
                  <div className="display text-3xl font-extrabold">{String(d.attrs.current_temperature ?? "–")}°</div>
                  <div className="num text-xs text-ink-soft">{d.state === "off" ? "off" : `${d.attrs.hvac_action ?? "idle"} · set ${d.attrs.temperature}°`}</div>
                </button>
              ))}
            </div>
          </section>
          {media.length > 0 && <section><h2 className="mb-2 text-lg font-extrabold">Playing</h2><div className="space-y-2">{media.map((d) => <MediaCard key={d.id} d={d} call={call} />)}</div></section>}
          <Sounds me={me} />
        </div>
      )}

      {tab === "rooms" && house && (
        room === null ? (
          <div key="rooms-list" className={`${pop ? "enter-left" : "enter"} space-y-5`}>
            <button className="card jaali flex h-16 w-full items-center justify-between px-4 text-left text-white shadow-lg" style={{ background: "var(--scene-night)" }} onClick={() => goRoom("primary_suite")}>
              <span className="text-lg font-extrabold">Primary Suite</span><span className="text-xs font-bold opacity-80">bedroom · bath · closet</span>
            </button>
            {house.floors.map((f) => (
              <section key={f}>
                <h2 className="mb-2 text-lg font-extrabold" style={{ color: FLOOR_COLOR[f] }}>{f}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {house.rooms.filter((r) => r.floor === f).map((r) => {
                    const on = r.devices.filter((d) => d.domain === "light" && d.state === "on").length;
                    return (
                      <button key={r.id} className="tile card flex h-20 flex-col justify-between border-l-8" style={{ borderColor: FLOOR_COLOR[f] }} onClick={() => goRoom(r.id)}>
                        <span className="font-extrabold leading-tight">{r.name}</span>
                        <span className="num text-xs font-bold text-ink-soft">{on ? `${on} light${on > 1 ? "s" : ""} on` : `${r.devices.length} thing${r.devices.length === 1 ? "" : "s"}`}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (() => {
          const r = room === "primary_suite" ? suite(house) : house.rooms.find((x) => x.id === room)!;
          const lights = r.devices.filter((d) => d.domain === "light");
          return (
            <section key={r.id} className="enter-right">
              <button className="mb-3 text-sm font-bold text-ink-soft" onClick={backToRooms}>‹ All rooms</button>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="display text-2xl font-extrabold">{r.name}</h2>
                {lights.length > 0 && <div className="flex gap-2 text-xs font-bold">
                  <button className="rounded-full px-3 py-1.5 text-white" style={{ background: FLOOR_COLOR[r.floor] }} onClick={() => call({ entity_ids: lights.map((l) => l.id), action: "turn_on" })}>All on</button>
                  <button className="rounded-full bg-ink px-3 py-1.5 text-cream" onClick={() => call({ entity_ids: lights.map((l) => l.id), action: "turn_off" })}>All off</button>
                </div>}
              </div>
              <div className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">{r.devices.map((d) => <DeviceTile key={d.id} d={d} call={call} color={FLOOR_COLOR[r.floor]} />)}</div>
            </section>
          );
        })()
      )}

      {tab === "entertain" && house && <div key="entertain" className="enter"><Entertain house={house} call={call} /></div>}

      {tab === "energy" && <div key="energy" className="enter"><Energy detail={me?.role === "owner"} /></div>}

      {tab === "climate" && house && <div key="climate" className="stagger space-y-3">{climates.map((d) => <ClimateCard key={d.id} d={d} call={call} big />)}</div>}

      {tab === "talk" && (
        <div key="talk" className="enter h-[calc(100dvh-14rem)]">
          {me?.role === "owner" && (
            <div className="mb-2 flex justify-end"><button className="rounded-full bg-ink/10 px-3 py-1 text-xs font-bold" onClick={() => setShowLog((v) => !v)}>{showLog ? "‹ Back to chat" : "History"}</button></div>
          )}
          {showLog && me?.role === "owner" ? <div className="scroll-y h-full pb-4"><Log /></div> : <Chat enabled={Boolean(me?.chat)} name={me?.name ?? "there"} />}
        </div>
      )}

      {!house && !error && <div className="card p-6 text-center text-ink-soft"><span className="pulse">Waking the house…</span></div>}

      {/* Toast sits just above the tab bar and leaves the way it came. */}
      <div className="toast pointer-events-none fixed inset-x-0 z-20 mx-auto flex max-w-xl justify-center px-4" style={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom, 0px))" }} data-hidden={toast ? "false" : "true"} role="status" aria-live="polite">
        <div className="glass rounded-full px-4 py-2 text-sm font-bold" style={{ color: "var(--ink)" }}>{toast ?? ""}</div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-xl px-4" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }} aria-label="Sections">
        <div className="glass relative flex rounded-[1.5rem] p-1.5">
          <div aria-hidden className="pill pointer-events-none absolute bottom-1.5 left-1.5 top-1.5 rounded-2xl" style={{ width: `calc((100% - 12px) / ${TABS.length})`, transform: `translateX(${tabIndex * 100}%)`, background: "var(--ink)" }} />
          {TABS.map(([k, l, i]) => {
            const active = tab === k;
            return (
              <button key={k} aria-current={active ? "page" : undefined} onClick={() => { setTab(k); if (k === "rooms") { setPop(false); setRoom(null); } }}
                className="relative z-10 flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-bold" style={{ color: active ? "var(--cream)" : "var(--ink)" }}>
                {Icon[i]()}{l}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
