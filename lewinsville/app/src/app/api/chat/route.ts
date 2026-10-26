// Talk to the house. Body: { messages: BetaMessageParam[] } (the client keeps the transcript).
// Streams SSE: {text} deltas, then {done, content} with the assistant turn to append.
import { chat, type ChatMessage } from "@/lib/claude";
import { personFrom } from "@/lib/identity";
import { append, withNotes } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const person = personFrom(req.headers);
  if (!person) return new Response("who are you?", { status: 401 });
  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "no_api_key" }, { status: 503 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const t0 = Date.now(); let reply = ""; let ok = true;
      const last = messages[messages.length - 1]?.content;
      const asked = typeof last === "string" ? last : Array.isArray(last) ? last.map((b) => ("text" in b ? b.text : "")).join(" ") : "";
      const did = await withNotes(async (did) => {
        try {
          for await (const ev of chat(person, messages.slice(-30))) { if ("text" in ev && ev.text) reply += ev.text; ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
        } catch (e) {
          ok = false; ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`));
        }
        return did;
      });
      ctrl.close();
      void append({ source: "app", who: person.name, asked: asked.slice(0, 300), reply: reply.slice(0, 500), did, ms: Date.now() - t0, ok });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
