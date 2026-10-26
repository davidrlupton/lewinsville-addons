// Button presses from the UI. Same allowlist as the agent's tools.
import { act } from "@/lib/claude";
import { hub } from "@/lib/ha";
import { SCENES, ENTERTAIN } from "@/lib/house";
import { personFrom } from "@/lib/identity";
import { append } from "@/lib/log";

export async function POST(req: Request) {
  const person = personFrom(req.headers);
  if (!person) return Response.json({ error: "who are you?" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const t0 = Date.now();
  const log = (asked: string, did: string[], ok: boolean) => void append({ source: "button", who: person.name, asked, reply: "", did, ms: Date.now() - t0, ok });
  try {
    if (body.scene) {
      const s = SCENES[body.scene as string];
      if (!s) return Response.json({ error: "unknown scene" }, { status: 400 });
      await hub().callService("button", "press", {}, { entity_id: s.entity });
      log(`scene ${s.label}`, [`scene ${s.label}`], true);
      return Response.json({ ok: true, did: `scene ${s.label}` });
    }
    if (body.mood) {
      const m = ENTERTAIN.moods[body.mood as string];
      if (!m) return Response.json({ error: "unknown mood" }, { status: 400 });
      await hub().callService("button", "press", {}, { entity_id: m.entity });
      log(`mood ${m.label}`, [`mood ${m.label}`], true);
      return Response.json({ ok: true, did: `mood ${m.label}` });
    }
    const ids: string[] = Array.isArray(body.entity_ids) ? body.entity_ids : [body.entity_id];
    const hs = Array.isArray(body.hs) && body.hs.length === 2 ? ([Number(body.hs[0]), Number(body.hs[1])] as [number, number]) : undefined;
    const out = [];
    for (const id of ids) out.push(await act(id, body.action, body.value, body.hvac_mode, hs));
    log(`${body.action} × ${ids.length}`, out, true);
    return Response.json({ ok: true, did: out });
  } catch (e) {
    log(String(body.scene ?? body.mood ?? body.action ?? "?"), [(e as Error).message], false);
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
