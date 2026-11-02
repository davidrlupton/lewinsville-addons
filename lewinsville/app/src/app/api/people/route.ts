// People, for owners: who is on the list, whether their phone is home, and the pause switch.
import { activePause, deviceHome, gate, pauses, setPause } from "@/lib/gate";
import { everyone } from "@/lib/identity";
import { append } from "@/lib/log";

export const dynamic = "force-dynamic";
const KINDS = ["on", "hour", "morning", "off"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(req: Request) {
  const g = await gate(req);
  if (g.deny) return g.deny;
  if (g.person.role !== "owner") return Response.json({ error: "owners only" }, { status: 403 });
  const p = await pauses();
  const people = await Promise.all(everyone().map(async (x) => ({
    email: x.email, name: x.name, role: x.role, wifiOnly: x.wifiOnly, device: x.device, home: await deviceHome(x.device), pause: activePause(p, x.email),
  })));
  return Response.json({ people });
}

export async function POST(req: Request) {
  const g = await gate(req);
  if (g.deny) return g.deny;
  if (g.person.role !== "owner") return Response.json({ error: "owners only" }, { status: 403 });
  const { email, kind } = (await req.json().catch(() => ({}))) as { email?: string; kind?: string };
  const who = everyone().find((x) => x.email === email);
  if (!who || !KINDS.includes(kind as Kind)) return Response.json({ error: "who and what?" }, { status: 400 });
  if (who.role === "owner") return Response.json({ error: "Owners cannot be paused" }, { status: 400 });
  await setPause(who.email, kind as Kind, g.person.name);
  void append({ source: "button", who: g.person.name, asked: kind === "on" ? `resume ${who.name}` : `pause ${who.name} (${kind})`, reply: "", did: [], ms: 0, ok: true });
  return Response.json({ ok: true });
}
