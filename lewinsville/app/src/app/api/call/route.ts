// Button presses from the UI. Same allowlist as the agent's tools.
import { act } from "@/lib/claude";
import { hub } from "@/lib/ha";
import { SCENES } from "@/lib/house";
import { personFrom } from "@/lib/identity";

export async function POST(req: Request) {
  if (!personFrom(req.headers)) return Response.json({ error: "who are you?" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.scene) {
      const s = SCENES[body.scene as string];
      if (!s) return Response.json({ error: "unknown scene" }, { status: 400 });
      await hub().callService("button", "press", {}, { entity_id: s.entity });
      return Response.json({ ok: true, did: `scene ${s.label}` });
    }
    const ids: string[] = Array.isArray(body.entity_ids) ? body.entity_ids : [body.entity_id];
    const out = [];
    for (const id of ids) out.push(await act(id, body.action, body.value, body.hvac_mode));
    return Response.json({ ok: true, did: out });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
