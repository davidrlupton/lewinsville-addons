import { gate } from "@/lib/gate";
import { greeting } from "@/lib/identity";
import { startJarvisLog } from "@/lib/jarvis_log";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await gate(req);
  if (g.deny) return g.deny;
  const p = g.person;
  startJarvisLog();
  return Response.json({ ...p, greeting: greeting(p.name), chat: Boolean(process.env.ANTHROPIC_API_KEY) });
}
