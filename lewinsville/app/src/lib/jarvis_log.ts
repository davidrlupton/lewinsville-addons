// Jarvis (the Voice PE puck) talks to Home Assistant directly, not through this app, so we copy each
// finished pipeline run out of HA's short-lived debug store into the request log once a minute.
import { hub } from "./ha";
import { append, recentIds } from "./log";

type Run = { pipeline_run_id: string; timestamp: string };
type Ev = { type: string; timestamp: string; data?: Record<string, unknown> };
let started = false;
const seen = new Set<string>();

// Watchdog for the Living Room Ear (the Jabra on the Assist Microphone add-on). A Wyoming satellite restarts its
// wake stage after every pipeline run, except when the run died early with an error: on 2026-11-08 a TTS language
// error left the ear deaf for forty minutes with HA reporting nothing wrong. If the ear's newest run has ended and
// nothing new started within 90 s, reload the "Assist Microphone" entry, at most once every ten minutes.
const EAR_DEVICE = "Living Room Ear"; const EAR_ENTRY = "Assist Microphone";
let lastKick = 0;
const SUP = process.env.SUPERVISOR_TOKEN;
const REST = SUP ? "http://supervisor/core/api" : (process.env.HA_URL ?? "http://192.168.1.237").replace(/\/$/, "") + "/api";
const REST_TOKEN = SUP ?? process.env.HA_TOKEN ?? "";

export function startJarvisLog() {
  if (started) return; started = true;
  recentIds("jarvis").then((ids) => { ids.forEach((i) => seen.add(i)); tick(); setInterval(tick, 60_000); }).catch(() => { started = false; });
}

async function tick() {
  try {
    const h = hub();
    const { pipelines } = await h.send<{ pipelines: { id: string; name: string }[] }>({ type: "assist_pipeline/pipeline/list" });
    for (const p of pipelines) {
      const { pipeline_runs } = await h.send<{ pipeline_runs: Run[] }>({ type: "assist_pipeline/pipeline_debug/list", pipeline_id: p.id });
      for (const r of pipeline_runs) {
        const id = `j${r.pipeline_run_id}`;
        if (seen.has(id)) continue;
        // Leave the newest run alone until it is at least 20 s old so we never log a half-finished one.
        if (Date.now() - Date.parse(r.timestamp) < 20_000) continue;
        seen.add(id);
        const { events } = await h.send<{ events: Ev[] }>({ type: "assist_pipeline/pipeline_debug/get", pipeline_id: p.id, pipeline_run_id: r.pipeline_run_id });
        const t: Record<string, number> = {}; let asked = ""; let reply = ""; let ok = true; const did: string[] = [];
        for (const e of events) {
          t[e.type] ??= Date.parse(e.timestamp);
          const d = e.data ?? {};
          if (e.type === "stt-end") asked = String((d.stt_output as { text?: string })?.text ?? "").trim();
          if (e.type === "intent-end") reply = String((d.intent_output as { response?: { speech?: { plain?: { speech?: string } } } })?.response?.speech?.plain?.speech ?? "");
          if (e.type === "intent-progress") { const delta = d.chat_log_delta as { tool_calls?: { tool_name: string; tool_args?: Record<string, unknown> }[] } | undefined; for (const c of delta?.tool_calls ?? []) did.push(`${c.tool_name}${c.tool_args ? " " + JSON.stringify(c.tool_args).slice(0, 80) : ""}`); }
          if (e.type === "error") { ok = false; reply ||= String(d.message ?? "error"); }
        }
        if (!asked && !reply) continue; // wake word only, nothing said
        const start = t["stt-end"] ?? t["run-start"]; const end = t["tts-end"] ?? t["intent-end"] ?? t["run-end"];
        await append({ id, at: r.timestamp, source: "jarvis", who: p.name, asked, reply, did, ms: start && end ? Math.max(0, end - start) : 0, ok });
      }
    }
    await watchEar(h, pipelines);
  } catch (e) { console.error("jarvis log:", (e as Error)?.message ?? JSON.stringify(e)); }
}

async function watchEar(h: ReturnType<typeof hub>, pipelines: { id: string; name: string }[]) {
  if (Date.now() - lastKick < 600_000) return;
  const devs = await h.send<{ id: string; name: string | null; name_by_user: string | null }[]>({ type: "config/device_registry/list" });
  const ear = devs.find((d) => (d.name_by_user ?? d.name) === EAR_DEVICE)?.id;
  if (!ear) return;
  // The ear's newest run across every pipeline (it can be moved between pipelines from its dropdown).
  let newest: { at: number; ended: boolean } | null = null;
  for (const p of pipelines) {
    const { pipeline_runs } = await h.send<{ pipeline_runs: Run[] }>({ type: "assist_pipeline/pipeline_debug/list", pipeline_id: p.id });
    for (const r of pipeline_runs.slice(-3)) {
      const { events } = await h.send<{ events: Ev[] }>({ type: "assist_pipeline/pipeline_debug/get", pipeline_id: p.id, pipeline_run_id: r.pipeline_run_id });
      const start = events.find((e) => e.type === "run-start");
      if ((start?.data as { device_id?: string } | undefined)?.device_id !== ear) continue;
      const at = Date.parse(r.timestamp);
      if (!newest || at > newest.at) newest = { at, ended: events.some((e) => e.type === "run-end") };
    }
  }
  if (!newest || !newest.ended || Date.now() - newest.at < 90_000) return;
  const entries = await h.send<{ entry_id: string; title: string }[]>({ type: "config_entries/get", domain: "wyoming" });
  const entry = entries.find((e) => e.title === EAR_ENTRY);
  if (!entry) return;
  lastKick = Date.now();
  const r = await fetch(`${REST}/config/config_entries/entry/${entry.entry_id}/reload`, { method: "POST", headers: { Authorization: `Bearer ${REST_TOKEN}` } });
  console.warn(`ear watchdog: wake stage stalled since ${new Date(newest.at).toISOString()}, reloaded ${EAR_ENTRY} (${r.status})`);
  void append({ source: "button", who: "house", asked: "ear watchdog: restart the Living Room Ear", reply: "", did: [`reload ${EAR_ENTRY} ${r.status}`], ms: 0, ok: r.ok });
}
