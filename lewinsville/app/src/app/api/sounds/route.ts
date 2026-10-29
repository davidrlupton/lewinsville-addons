// Recorded sounds: list (anyone signed in), add (owners and household), delete (owners), play (anyone).
import { personFrom } from "@/lib/identity";
import { append } from "@/lib/log";
import { addSound, listSounds, playSound, removeSound, SPEAKERS } from "@/lib/sounds";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!personFrom(req.headers)) return Response.json({ error: "who are you?" }, { status: 401 });
  return Response.json({ sounds: await listSounds(), speakers: Object.entries(SPEAKERS).map(([k, v]) => ({ key: k, label: v.label })) });
}

export async function POST(req: Request) {
  const person = personFrom(req.headers);
  if (!person) return Response.json({ error: "who are you?" }, { status: 401 });
  const t0 = Date.now();
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("multipart/form-data")) {
      if (person.role === "guest") return Response.json({ error: "Guests can play sounds, not add them" }, { status: 403 });
      const form = await req.formData();
      const file = form.get("file"); const name = String(form.get("name") ?? "");
      if (!(file instanceof File)) return Response.json({ error: "No audio" }, { status: 400 });
      if (file.size > 25_000_000) return Response.json({ error: "That file is too big (25 MB max)" }, { status: 413 });
      const s = await addSound(name || file.name.replace(/\.[^.]+$/, ""), person.name, Buffer.from(await file.arrayBuffer()), file.type || "");
      void append({ source: "button", who: person.name, asked: `add sound ${s.name}`, reply: "", did: [`saved ${s.file}`], ms: Date.now() - t0, ok: true });
      return Response.json({ ok: true, sound: s });
    }
    const body = await req.json().catch(() => ({}));
    if (body.play) {
      const did = await playSound(String(body.play), String(body.where ?? "living"));
      void append({ source: "button", who: person.name, asked: `play ${did}`, reply: "", did: [did], ms: Date.now() - t0, ok: true });
      return Response.json({ ok: true, did });
    }
    return Response.json({ error: "nothing to do" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const person = personFrom(req.headers);
  if (!person) return Response.json({ error: "who are you?" }, { status: 401 });
  if (person.role !== "owner") return Response.json({ error: "Owners only" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json({ ok: await removeSound(id) });
}
