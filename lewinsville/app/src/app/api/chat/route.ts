// Talk to the house. Body: { messages: BetaMessageParam[] } (the client keeps the transcript).
// Streams SSE: {text} deltas, then {done, content} with the assistant turn to append.
import { chat, type ChatMessage } from "@/lib/claude";
import { personFrom } from "@/lib/identity";

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
      try {
        for await (const ev of chat(person, messages.slice(-30))) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      } catch (e) {
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
