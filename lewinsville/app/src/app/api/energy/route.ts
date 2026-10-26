import { getEnergy, type Range } from "@/lib/energy";
import { personFrom } from "@/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!personFrom(req.headers)) return Response.json({ error: "who are you?" }, { status: 401 });
  const r = new URL(req.url).searchParams.get("range");
  const range: Range = r === "week" || r === "month" || r === "year" ? r : "today";
  try { return Response.json(await getEnergy(range)); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}
