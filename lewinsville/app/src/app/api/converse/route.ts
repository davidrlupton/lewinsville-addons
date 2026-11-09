// Teddy's ear talks to the brain here (PLAN.md Phase 5). Body: { text, conversation? }. The caller must send
// header x-teddy-token equal to TEDDY_TOKEN (shared through both add-ons' options); the Cloudflare identity
// header is never trusted on this route. Returns { text, conversation }. A conversation is the follow-up
// thread of one exchange: it lives in memory and is forgotten after five minutes of silence, so the ear can
// keep a thread across the follow-up window without the client holding the transcript.
import { chat, type ChatMessage } from "@/lib/claude";
import type { Person } from "@/lib/identity";
import { append, withNotes } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VOICE: Person = { email: "voice@lewinsville.vip", name: "the family", role: "household", theme: "festival", wifiOnly: true };
const THREAD_TTL = 5 * 60_000;
const threads = new Map<string, { history: ChatMessage[]; last: number }>();

function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
}

export async function POST(req: Request) {
  const token = process.env.TEDDY_TOKEN;
  if (!token || req.headers.get("x-teddy-token") !== token) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "no_api_key" }, { status: 503 });
  const { text, conversation } = (await req.json()) as { text?: string; conversation?: string };
  if (!text?.trim()) return Response.json({ error: "no_text" }, { status: 400 });

  const now = Date.now();
  for (const [k, v] of threads) if (now - v.last > THREAD_TTL) threads.delete(k);
  const id = conversation && threads.has(conversation) ? conversation : `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const thread = threads.get(id) ?? { history: [], last: now };
  threads.set(id, thread);

  const t0 = Date.now(); let reply = ""; let ok = true; let error: string | undefined;
  const user: ChatMessage = { role: "user", content: text.trim() };
  const did = await withNotes(async (did) => {
    try {
      for await (const ev of chat(VOICE, [...thread.history, user], { voice: true })) {
        if ("done" in ev) {
          reply = textOf(ev.content) || reply;
          thread.history.push(user, ev.context as ChatMessage, { role: "assistant", content: ev.content } as ChatMessage);
          thread.history = thread.history.slice(-24);
          thread.last = Date.now();
        }
      }
    } catch (e) { ok = false; error = (e as Error).message; }
    return did;
  });
  void append({ source: "teddy", who: "Living Room Ear", asked: text.slice(0, 300), reply: (reply || error || "").slice(0, 500), did, ms: Date.now() - t0, ok });
  if (!ok) return Response.json({ error, conversation: id }, { status: 502 });
  return Response.json({ text: reply, conversation: id, did });
}
