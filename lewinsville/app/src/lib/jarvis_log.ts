// Jarvis (the Voice PE puck) talks to Home Assistant directly, not through this app, so we copy each
// finished pipeline run out of HA's short-lived debug store into the request log once a minute.
import { hub } from "./ha";
import { append, recentIds } from "./log";

type Run = { pipeline_run_id: string; timestamp: string };
type Ev = { type: string; timestamp: string; data?: Record<string, unknown> };
let started = false;
const seen = new Set<string>();

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
  } catch (e) { console.error("jarvis log:", (e as Error).message); }
}
