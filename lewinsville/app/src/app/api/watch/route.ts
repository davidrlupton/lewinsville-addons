// The camera watch, for owners: GET lists the last days' reviews; GET ?img=<id>[&scene=1] is the picture;
// POST {id, grade: "fine" | "not_fine"} records an owner's judgement of a verdict.
import { readFile } from "node:fs/promises";
import { gate } from "@/lib/gate";
import { grade, imageFile, reviews } from "@/lib/watch";

export const dynamic = "force-dynamic";

async function owner(req: Request) {
  const g = await gate(req);
  if (g.deny) return { deny: g.deny, name: "" };
  if (g.person.role !== "owner") return { deny: Response.json({ error: "owners only" }, { status: 403 }), name: "" };
  return { deny: null, name: g.person.name };
}

export async function GET(req: Request) {
  const o = await owner(req); if (o.deny) return o.deny;
  const q = new URL(req.url).searchParams;
  const img = q.get("img");
  if (img) {
    try { return new Response(new Uint8Array(await readFile(imageFile(img, q.get("scene") === "1"))), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } }); }
    catch { return new Response(null, { status: 404 }); }
  }
  return Response.json({ reviews: await reviews(Math.min(31, Math.max(1, Number(q.get("days") ?? 2)))) });
}

export async function POST(req: Request) {
  const o = await owner(req); if (o.deny) return o.deny;
  const { id, grade: value } = (await req.json().catch(() => ({}))) as { id?: string; grade?: string };
  if (!id || (value !== "fine" && value !== "not_fine")) return Response.json({ error: "id and grade" }, { status: 400 });
  await grade(id, value, o.name);
  return Response.json({ ok: true });
}
