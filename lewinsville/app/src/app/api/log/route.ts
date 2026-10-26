// The request log, for owners: GET ?days=14 lists it; POST {id, on} flags an entry as a miss to review.
import { recent, setFlag } from "@/lib/log";
import { startJarvisLog } from "@/lib/jarvis_log";
import { personFrom } from "@/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = personFrom(req.headers);
  if (!p) return Response.json({ error: "who are you?" }, { status: 401 });
  if (p.role !== "owner") return Response.json({ error: "owners only" }, { status: 403 });
  startJarvisLog();
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 14)));
  return Response.json({ entries: await recent(days) });
}

export async function POST(req: Request) {
  const p = personFrom(req.headers);
  if (!p) return Response.json({ error: "who are you?" }, { status: 401 });
  if (p.role !== "owner") return Response.json({ error: "owners only" }, { status: 403 });
  const { id, on } = (await req.json().catch(() => ({}))) as { id?: string; on?: boolean };
  if (!id) return Response.json({ error: "id" }, { status: 400 });
  await setFlag(id, on !== false);
  return Response.json({ ok: true });
}
