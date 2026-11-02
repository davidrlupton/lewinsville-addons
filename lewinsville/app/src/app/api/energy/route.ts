import { getEnergy, type Range } from "@/lib/energy";
import { gate } from "@/lib/gate";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await gate(req);
  if (g.deny) return g.deny;
  const r = new URL(req.url).searchParams.get("range");
  const range: Range = r === "week" || r === "month" || r === "year" ? r : "today";
  try { return Response.json(await getEnergy(range)); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}
