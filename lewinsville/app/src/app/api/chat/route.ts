// Talk to the house. Body: { messages: BetaMessageParam[] } (the client keeps the transcript).
// Streams SSE: {text} deltas, then {done, content, context}: the context (system) message and the assistant turn, both to append.
import { chat, type ChatMessage } from "@/lib/claude";
import { gate } from "@/lib/gate";
import { append, withNotes } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Keep the last 30 entries, but start on a user turn: a system (context) message can't be first, and an
// assistant turn without its user turn is invalid.
function trim(messages: ChatMessage[]): ChatMessage[] {
  const m = messages.slice(-30);
  const first = m.findIndex((x) => x.role === "user");
  return first > 0 ? m.slice(first) : m;
}

export async function POST(req: Request) {
  const g = await gate(req);
  if (g.deny) return g.deny;
  const person = g.person;
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
          for await (const ev of chat(person, trim(messages))) { if ("text" in ev && ev.text) reply += ev.text; ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
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
