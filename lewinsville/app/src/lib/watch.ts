// Camera watch, phase 1: quiet (CAMERA_WATCH.md). The portal already holds a live copy of every HA entity, so it
// watches the Protect smart-detection events itself: a person, vehicle or package on a camera -> the event's
// thumbnail and a frame of the scene -> one Claude call with the house's context -> a verdict written to
// /share/lewinsville/watch. Nothing here makes a sound, sends a message or touches a device; owners grade the
// verdicts on the Watch card. On any failure it logs and stays silent.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hub, haFetch, type HassEntities } from "./ha";
import { client, VOICE_MODEL } from "./claude";
import { everyone } from "./identity";

export type Verdict = "family" | "expected" | "unexpected" | "unsure" | "error";
export type Review = {
  id: string; at: string; camera: string; kind: string; verdict: Verdict; who: string; why: string;
  confidence: number; protectedHours: boolean; guests: boolean; ms: number; grade?: "fine" | "not_fine";
};
type Line = Review | { grade: string; value: "fine" | "not_fine"; by: string; at: string };

export const DIR = `${process.env.LOG_DIR ?? (process.env.SUPERVISOR_TOKEN ? "/share/lewinsville" : ".lhh-log")}/watch`;
const monthFile = (d: Date) => `${DIR}/reviews-${d.toISOString().slice(0, 7)}.jsonl`;
export const imageFile = (id: string, scene = false) => `${DIR}/img/${id.replace(/[^a-z0-9]/gi, "")}${scene ? "-scene" : ""}.jpg`;

const KINDS = new Set(["person", "vehicle", "car", "package", "face", "license_plate"]);   // animals are ignored
const DEBOUNCE = 120_000;        // one review per camera per two minutes
const DAILY_CAP = 300;           // a stuck camera cannot run up the bill
const TZ = "America/New_York";

type Known = { protected_hours: { from: string; until: string }; cameras?: Record<string, string>; vehicles: unknown[]; people: unknown[] };
function known(): Known {
  for (const f of [join(process.cwd(), "watch", "known.json"), join(process.cwd(), "..", "ha", "watch", "known.json")]) {
    try { return JSON.parse(readFileSync(f, "utf-8")); } catch { /* try the next */ }
  }
  return { protected_hours: { from: "22:00", until: "06:00" }, vehicles: [], people: [] };
}
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
function inHours(now: string, from: string, until: string) { return from <= until ? now >= from && now < until : now >= from || now < until; }
const ago = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? Math.round((Date.now() - Date.parse(iso)) / 1000) : null);

function context(camera: string, kind: string, ents: HassEntities, k: Known) {
  const now = new Date();
  const prot = inHours(hhmm(now), k.protected_hours.from, k.protected_hours.until);
  const guests = ents["input_boolean.guests_tonight"]?.state === "on" || ents["switch.first_floor_kitchen_first_floor_kitchen_at_column_position_3_keypad_entertain_led"]?.state === "on";
  const lines = [
    `Local time: ${now.toLocaleString("en-US", { timeZone: TZ, weekday: "long", hour: "numeric", minute: "2-digit" })}. ${ents["sun.sun"]?.state === "below_horizon" ? "It is dark outside." : "It is daylight."}`,
    `Protected hours (${k.protected_hours.from} to ${k.protected_hours.until}): ${prot ? "yes, now" : "no"}. Guests expected tonight: ${guests ? "yes" : "no"}.`,
    `Camera: ${camera.replace(/_/g, " ")}${k.cameras?.[camera] ? ` (${k.cameras[camera]})` : ""}. Protect detected: ${kind}.`,
    `What Protect reported: ${JSON.stringify(ents[`event.${camera}_smart_detection`]?.attributes ?? {}, (key, v) => (["event_types", "attribution", "friendly_name"].includes(key) ? undefined : v))}`,
  ];
  const veh = ents[`event.${camera}_vehicle`];
  const vehAgo = ago(veh?.state);
  if (vehAgo !== null && vehAgo < 180) lines.push(`Vehicle seen on this camera ${vehAgo}s ago: ${JSON.stringify(veh.attributes.attributes ?? {})}`);
  const others = Object.keys(ents).filter((e) => /^event\..+_smart_detection$/.test(e) && e !== `event.${camera}_smart_detection`)
    .map((e) => [e.slice(6, -16).replace(/_/g, " "), ents[e].attributes.event_type, ago(ents[e].state)] as const).filter(([, , s]) => s !== null && s < 300);
  if (others.length) lines.push(`Other cameras in the last five minutes: ${others.map(([c, t, s]) => `${c} saw ${t} ${s}s ago`).join("; ")}.`);
  const ring = ago(ents["event.front_door_doorbell"]?.state);
  if (ring !== null && ring < 300) lines.push(`The doorbell was rung ${ring}s ago.`);
  const phones = everyone().filter((p) => p.device && ents[p.device]).map((p) => `${p.name}'s phone ${ents[p.device!].state === "home" ? "is home" : "is away"}`);
  if (phones.length) lines.push(`Phones: ${phones.join("; ")}.`);
  lines.push(`Known vehicles (true plates; the cameras often misread a character or two, so match loosely and use colour and body type): ${JSON.stringify(k.vehicles)}`);
  if (k.people.length) lines.push(`Known people and regulars: ${JSON.stringify(k.people)}`);
  return { text: lines.join("\n"), prot, guests };
}

const SYSTEM = `You review one camera detection at a family home (two adults, two young children) and decide whether it
is worth anyone's attention. You get a close crop of what the camera detected, a wider frame of the scene taken a
moment later, and what the house knows. Answer with the verdict tool, once.

family: a member of the household or a family vehicle. expected: a known regular, a delivery, the mail, a trade
working in daylight, a guest when guests are expected, someone passing on the street or pavement. unexpected: a
person or vehicle that does not fit the time and place, such as someone unknown close to the house at night, in
the back yard or by the workshop, trying a door or a car, or looking in. unsure: you cannot tell; say what is
missing.

You cannot recognise anyone by their face and must not try. Go by what the house tells you (plates, phones that
are home, the doorbell, guests expected), by vehicles, by what the person is doing and carrying, and by the time.
Someone walking in from a known car with shopping while the family's phones are home is family or expected.
During protected hours be stricter: an adult you cannot place near the house is unexpected. "who" is a short
description, never a guess at a stranger's identity. "why" is one plain sentence a child could hear.`;

const TOOL = {
  name: "verdict", description: "Record the verdict for this detection.",
  input_schema: {
    type: "object" as const, required: ["verdict", "who", "why", "confidence"],
    properties: {
      verdict: { type: "string", enum: ["family", "expected", "unexpected", "unsure"] },
      who: { type: "string", description: "Short description, e.g. 'adult carrying shopping bags', 'blue SUV, likely Pratima'" },
      why: { type: "string", description: "One plain sentence" },
      confidence: { type: "number", description: "0 to 1" },
    },
  },
};

async function jpeg(path: string): Promise<Buffer | null> {
  try { const r = await haFetch(path); return r.ok && (r.headers.get("content-type") ?? "").includes("image") ? Buffer.from(await r.arrayBuffer()) : null; }
  catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let protectEntry: string | null = null;
async function thumbnail(eventId: string) {
  if (!protectEntry) protectEntry = (await hub().send<{ entry_id: string; domain: string }[]>({ type: "config_entries/get", domain: "unifiprotect" }))[0]?.entry_id ?? null;
  if (!protectEntry) return null;
  for (const wait of [4000, 6000]) {   // Protect cuts the thumbnail a few seconds into the event
    await sleep(wait);
    const img = await jpeg(`unifiprotect/thumbnail/${protectEntry}/${eventId}`);
    if (img) return img;
  }
  return null;
}

async function review(camera: string, kind: string, eventId: string | undefined, ents: HassEntities) {
  const t0 = Date.now(); const id = `${t0.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const k = known(); const ctx = context(camera, kind, ents, k);
  const out: Review = { id, at: new Date().toISOString(), camera, kind, verdict: "error", who: "", why: "", confidence: 0, protectedHours: ctx.prot, guests: ctx.guests, ms: 0 };
  try {
    const [scene, crop] = await Promise.all([jpeg(`camera_proxy/camera.${camera}_high_resolution_channel?width=1280&height=720`), eventId ? thumbnail(eventId) : null]);
    if (!scene && !crop) throw new Error("no picture");
    await mkdir(`${DIR}/img`, { recursive: true });
    if (crop) await writeFile(imageFile(id), crop);
    if (scene) await writeFile(imageFile(id, true), scene);
    const image = (b: Buffer) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.toString("base64") } });
    const msg = await client().messages.create({
      model: VOICE_MODEL, max_tokens: 400, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "verdict" },
      messages: [{ role: "user", content: [
        ...(crop ? [{ type: "text" as const, text: "Close crop of the detection:" }, image(crop)] : []),
        ...(scene ? [{ type: "text" as const, text: "The scene a few seconds later:" }, image(scene)] : []),
        { type: "text" as const, text: ctx.text },
      ] }],
    });
    const use = msg.content.find((b) => b.type === "tool_use");
    if (!use || use.type !== "tool_use") throw new Error("no verdict");
    const v = use.input as { verdict: Verdict; who?: string; why?: string; confidence?: number };
    Object.assign(out, { verdict: v.verdict, who: String(v.who ?? "").slice(0, 120), why: String(v.why ?? "").slice(0, 300), confidence: Number(v.confidence) || 0 });
  } catch (e) { out.why = (e as Error).message.slice(0, 200); }
  out.ms = Date.now() - t0;
  try { await mkdir(DIR, { recursive: true }); await appendFile(monthFile(new Date()), JSON.stringify(out) + "\n"); } catch (e) { console.error("watch log:", (e as Error).message); }
  console.log(`watch: ${camera} ${kind} -> ${out.verdict} (${out.who}) ${out.ms}ms`);
}

/** Begin watching. Called once at server start, in the add-on only. */
export function startWatch() {
  const g = globalThis as typeof globalThis & { __lhhWatch?: boolean };
  if (g.__lhhWatch) return; g.__lhhWatch = true;
  const seen = new Map<string, string>(); const last = new Map<string, number>(); let day = ""; let count = 0; let primed = false;
  hub().onChange((ents) => {
    for (const e of Object.keys(ents)) {
      const m = /^event\.(.+)_smart_detection$/.exec(e); if (!m) continue;
      const s = ents[e]; const was = seen.get(e); seen.set(e, s.state);
      if (!primed || was === undefined || was === s.state || Number.isNaN(Date.parse(s.state))) continue;   // first sight, or no new event
      const kind = String(s.attributes.event_type ?? "");
      if (!KINDS.has(kind) || Date.now() - (last.get(m[1]) ?? 0) < DEBOUNCE) continue;
      const today = new Date().toDateString(); if (today !== day) { day = today; count = 0; }
      if (++count > DAILY_CAP) continue;
      last.set(m[1], Date.now());
      void review(m[1], kind, s.attributes.event_id as string | undefined, ents);
    }
    primed = true;
  });
  const connect = () => hub().connect().catch(() => setTimeout(connect, 30_000));   // HA may still be starting
  connect();
  console.log("watch: started (quiet)");
}

/** Reviews from the last `days`, newest first, with grades applied. */
export async function reviews(days = 2): Promise<Review[]> {
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lines: Line[] = [];
  for (const f of [monthFile(prev), monthFile(now)]) {
    try { for (const l of (await readFile(f, "utf8")).split("\n")) if (l.trim()) lines.push(JSON.parse(l)); } catch { /* no file yet */ }
  }
  const grades = new Map<string, "fine" | "not_fine">(); const out: Review[] = [];
  for (const l of lines) { if ("grade" in l && "value" in l) grades.set(l.grade, l.value); else out.push(l as Review); }
  const cutoff = Date.now() - days * 86400_000;
  return out.filter((r) => Date.parse(r.at) >= cutoff).map((r) => ({ ...r, grade: grades.get(r.id) })).sort((a, b) => b.at.localeCompare(a.at));
}
export async function grade(id: string, value: "fine" | "not_fine", by: string) {
  await mkdir(DIR, { recursive: true });
  await appendFile(monthFile(new Date()), JSON.stringify({ grade: id, value, by, at: new Date().toISOString() }) + "\n");
}
