import { personFrom, greeting } from "@/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = personFrom(req.headers);
  if (!p) return Response.json({ error: "who are you?" }, { status: 401 });
  return Response.json({ ...p, greeting: greeting(p.name), chat: Boolean(process.env.ANTHROPIC_API_KEY) });
}
