// The request log: every ask of the house, from the Talk tab, the app's buttons and Jarvis, one JSON line
// each, in monthly files under /share/lewinsville on the hub (so backups and SSH can see them). Nothing
// here is needed for the house to work; it exists so the family and Claude can review misses and improve.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";

export type Source = "app" | "button" | "jarvis";
export type Entry = {
  id: string; at: string; source: Source; who: string;
  asked: string; reply: string; did: string[]; ms: number; ok: boolean; flagged?: boolean;
};
type Line = Entry | { flag: string; on: boolean; at: string };

const DIR = process.env.LOG_DIR ?? (process.env.SUPERVISOR_TOKEN ? "/share/lewinsville" : ".lhh-log");
const monthFile = (d: Date) => `${DIR}/requests-${d.toISOString().slice(0, 7)}.jsonl`;

async function write(line: Line) {
  try { await mkdir(DIR, { recursive: true }); await appendFile(monthFile(new Date()), JSON.stringify(line) + "\n"); }
  catch (e) { console.error("request log:", (e as Error).message); }
}

export async function append(e: Omit<Entry, "id" | "at"> & Partial<Pick<Entry, "id" | "at">>) {
  const entry: Entry = { id: e.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: e.at ?? new Date().toISOString(), ...e } as Entry;
  await write(entry);
  return entry;
}
export async function setFlag(id: string, on: boolean) { await write({ flag: id, on, at: new Date().toISOString() }); }

/** Entries from the last `days`, newest first, with flags applied. */
export async function recent(days = 14): Promise<Entry[]> {
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lines: Line[] = [];
  for (const f of [monthFile(prev), monthFile(now)]) {
    try { for (const l of (await readFile(f, "utf8")).split("\n")) if (l.trim()) lines.push(JSON.parse(l)); } catch { /* no file yet */ }
  }
  const flags = new Map<string, boolean>();
  const entries: Entry[] = [];
  for (const l of lines) { if ("flag" in l) flags.set(l.flag, l.on); else entries.push(l); }
  const cutoff = Date.now() - days * 86400_000;
  return entries.filter((e) => Date.parse(e.at) >= cutoff).map((e) => ({ ...e, flagged: flags.get(e.id) ?? false })).sort((a, b) => b.at.localeCompare(a.at));
}
export async function recentIds(source: Source, days = 3) { return new Set((await recent(days)).filter((e) => e.source === source).map((e) => e.id)); }

// What the agent did during one request, collected from act()/set_scene/set_mood wherever they run.
const notes = new AsyncLocalStorage<string[]>();
export function withNotes<T>(fn: (did: string[]) => Promise<T>): Promise<T> { const did: string[] = []; return notes.run(did, () => fn(did)); }
export function note(s: string) { notes.getStore()?.push(s); }
