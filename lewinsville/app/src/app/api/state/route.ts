// Live house state as Server-Sent Events: a full snapshot first, then a fresh snapshot whenever
// anything changes (throttled). Simple and robust for a handful of phones.
import { hub } from "@/lib/ha";
import { getHouse } from "@/lib/house";
import { personFrom } from "@/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!personFrom(req.headers)) return new Response("who are you?", { status: 401 });
  const h = hub();
  await h.connect();
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = async () => {
        if (closed) return;
        try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(await getHouse())}\n\n`)); } catch { /* stream gone */ }
      };
      await send();
      const off = h.onChange(() => { clearTimeout(timer); timer = setTimeout(send, 150); });
      const ping = setInterval(() => { if (!closed) ctrl.enqueue(enc.encode(": ping\n\n")); }, 25_000);
      req.signal.addEventListener("abort", () => { closed = true; off(); clearInterval(ping); clearTimeout(timer); try { ctrl.close(); } catch { /* already closed */ } });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
