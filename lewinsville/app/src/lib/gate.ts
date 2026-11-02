// Who may do what right now. Cloudflare Access already proved the email; this adds the house's own
// rules: wifi-only people (visitors) get in only from inside the house, owners can pause anyone for a
// while, and a breather stops one switch being treated like a toy. Owners are never turned away.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hub } from "@/lib/ha";
import { personFrom, type Person } from "@/lib/identity";

const DIR = process.env.LOG_DIR ?? (process.env.SUPERVISOR_TOKEN ? "/share/lewinsville" : ".lhh-log");
const FILE = `${DIR}/people.json`;
// The UDM Pro Max as the UniFi integration tracks it: its `ip` attribute is the house's public address,
// so "inside the house" is simply "Cloudflare saw this request arrive from that address". No static IP
// needed; when Verizon changes it, HA knows within a minute.
const DREAM = "device_tracker.dream";

export type Pause = { kind: "hour" | "morning" | "off"; until: string | null; by: string; at: string };
type Pauses = Record<string, Pause>;

let cached: { at: number; p: Pauses } | null = null;
export async function pauses(): Promise<Pauses> {
  if (cached && Date.now() - cached.at < 3000) return cached.p;
  let p: Pauses = {};
  try { p = JSON.parse(await readFile(FILE, "utf8")); } catch { /* none yet */ }
  cached = { at: Date.now(), p };
  return p;
}
function nextMorning() { const d = new Date(); if (d.getHours() >= 7) d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); return d; }
export async function setPause(email: string, kind: Pause["kind"] | "on", by: string) {
  const p = { ...(await pauses()) };
  if (kind === "on") delete p[email];
  else {
    const until = kind === "hour" ? new Date(Date.now() + 3600_000) : kind === "morning" ? nextMorning() : null;
    p[email] = { kind, until: until ? until.toISOString() : null, by, at: new Date().toISOString() };
  }
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(p, null, 1));
  cached = null;
}
/** The pause in force for this email, or null once it has run out. */
export function activePause(p: Pauses, email: string): Pause | null {
  const x = p[email];
  if (!x) return null;
  if (x.until && Date.parse(x.until) <= Date.now()) return null;
  return x;
}

/** Did this request come from inside the house? */
export async function fromHouse(headers: Headers): Promise<boolean> {
  const ip = headers.get("cf-connecting-ip");
  if (!ip) return false;
  try { const h = hub(); await h.connect(); return h.entities[DREAM]?.attributes?.ip === ip; } catch { return false; }
}
/** Is this person's known phone on the house network? null when no phone is on record. */
export async function deviceHome(device?: string): Promise<boolean | null> {
  if (!device) return null;
  try { const h = hub(); await h.connect(); return h.entities[device]?.state === "home"; } catch { return false; }
}

// The breather: more than LIMIT actions on one thing inside WINDOW and the house asks for a minute.
// Sliders send once per gesture, so eight is a lot of real use and not much of a game.
const LIMIT = 8, WINDOW = 120_000;
const acts = new Map<string, number[]>();
function breathe(email: string, key: string): boolean {
  const k = `${email}|${key}`, now = Date.now();
  const ts = (acts.get(k) ?? []).filter((t) => now - t < WINDOW);
  ts.push(now); acts.set(k, ts);
  return ts.length > LIMIT;
}

const turnAway = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) => Response.json({ code, error, ...extra }, { status });
const when = (iso: string | null) => (iso ? ` until ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "");

/** The person behind a request, or the Response that turns them away. `act` names what they are about to do, for the breather. */
export async function gate(req: Request, act?: string): Promise<{ person: Person; deny: null } | { person: Person | null; deny: Response }> {
  const person = personFrom(req.headers);
  if (!person) return { person: null, deny: turnAway(401, "who", "who are you?") };
  if (person.role === "owner") return { person, deny: null };
  const pause = activePause(await pauses(), person.email);
  if (pause) return { person, deny: turnAway(403, "paused", `Paused by ${pause.by}${when(pause.until)}.`, { until: pause.until, by: pause.by }) };
  if (person.wifiOnly) {
    if (!(await fromHouse(req.headers))) return { person, deny: turnAway(403, "away", "The house app only works on the house wifi.") };
    if (person.device && (await deviceHome(person.device)) === false) return { person, deny: turnAway(403, "away", "The house app only works from your own phone on the house wifi.") };
  }
  if (act && breathe(person.email, act)) return { person, deny: turnAway(429, "breather", "Give that one a minute.") };
  return { person, deny: null };
}
