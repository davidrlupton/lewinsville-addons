// Teddy's ear talks to the brain here (PLAN.md Phase 5). Body: { text, conversation? }. The caller must send
// header x-teddy-token equal to TEDDY_TOKEN (shared through both add-ons' options); the Cloudflare identity
// header is never trusted on this route. A conversation is the follow-up thread of one exchange: it lives in
// memory and is forgotten after five minutes of silence, so the ear can keep a thread across the follow-up
// window without holding the transcript.
//
// Response: with ?stream=1, newline-delimited JSON: {"sentence": "..."} as each sentence of the reply completes
// (the ear starts speaking the first while the rest is still being written), then {"done": true, text,
// conversation, did}. Without it, one JSON object { text, conversation, did }.
import { chat, type ChatMessage } from "@/lib/claude";
import type { Person } from "@/lib/identity";
import { append, withNotes } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VOICE: Person = { email: "voice@lewinsville.vip", name: "the family", role: "household", theme: "festival", wifiOnly: true };
const THREAD_TTL = 5 * 60_000;
const threads = new Map<string, { history: ChatMessage[]; last: number; acted?: string[] }>();
const SAME_TALK = 120_000;   // a voice turn within two minutes of the last one, from either ear, is the same conversation

function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
}

// Split off complete sentences; keep the tail. A sentence ends at . ! ? followed by a space, unless the
// "sentence" is too short to be worth a separate synthesis (abbreviations, "Yes.").
function takeSentences(buf: string): [string[], string] {
  const out: string[] = []; let rest = buf;
  for (;;) {
    const m = /[.!?]["')\]]?\s+/.exec(rest);
    if (!m) break;
    const cut = m.index + m[0].length;
    const s = rest.slice(0, cut).trim();
    if (s.length < 12 && out.length === 0 && rest.length > cut) { // too short to stand alone: glue to the next
      const m2 = /[.!?]["')\]]?\s+/.exec(rest.slice(cut));
      if (!m2) break;
      const cut2 = cut + m2.index + m2[0].length;
      out.push(rest.slice(0, cut2).trim()); rest = rest.slice(cut2); continue;
    }
    out.push(s); rest = rest.slice(cut);
  }
  return [out, rest];
}

export async function POST(req: Request) {
  const token = process.env.TEDDY_TOKEN;
  if (!token || req.headers.get("x-teddy-token") !== token) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "no_api_key" }, { status: 503 });
  const { text, conversation, who, heard } = (await req.json()) as { text?: string; conversation?: string; who?: string; heard?: string };
  if (!text?.trim()) return Response.json({ error: "no_text" }, { status: 400 });
  const streaming = new URL(req.url).searchParams.get("stream") === "1";

  const now = Date.now();
  for (const [k, v] of threads) if (now - v.last > THREAD_TTL) threads.delete(k);
  // One Teddy, one memory: the living-room ear and the kitchen puck each kept their own thread, so a question to
  // the puck about what the ear had just done got "I haven't done anything" (2026-11-14). The most recent thread
  // wins while it is fresh, whichever ear it came from.
  const recent = [...threads.entries()].filter(([, v]) => now - v.last < SAME_TALK).sort((a, b) => b[1].last - a[1].last)[0]?.[0];
  const id = recent ?? (conversation && threads.has(conversation) ? conversation : `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const thread = threads.get(id) ?? { history: [], last: now };
  threads.set(id, thread);
  // How the words reached Teddy, for the brain (the voice prompt in lib/claude.ts explains the tags).
  const tag = who === "Kitchen puck" ? "[kitchen puck]" : heard === "followup" ? "[living room, follow-up]" : "[living room, after wake]";
  // The history keeps only what Teddy said, not its tool calls, so say what it actually did last time.
  const acted = thread.acted?.length ? `[done by you in your last reply: ${thread.acted.join("; ").slice(0, 400)}] ` : "";
  const user: ChatMessage = { role: "user", content: `${acted}${tag} ${text.trim()}` };

  const enc = new TextEncoder();
  const run = async (emit: (o: object) => void) => {
    const t0 = Date.now(); let reply = ""; let buf = ""; let ok = true; let error: string | undefined; let silent = false;
    // "SILENCE" is the brain's way of saying the ear woke on something not meant for Teddy: nothing is spoken.
    const say = (s: string) => { if (/^silence[.!]?$/i.test(s.trim())) { silent = true; return; } emit({ sentence: s }); };
    const did = await withNotes(async (did) => {
      try {
        for await (const ev of chat(VOICE, [...thread.history, user], { voice: true })) {
          if ("text" in ev && ev.text) {
            buf += ev.text;
            const [sentences, rest] = takeSentences(buf); buf = rest;
            for (const s of sentences) say(s);
          }
          if ("done" in ev) {
            reply = textOf(ev.content) || reply;
            thread.history.push(user, ev.context as ChatMessage, { role: "assistant", content: ev.content } as ChatMessage);
            thread.history = thread.history.slice(-24);
            thread.last = Date.now(); thread.acted = [...did];
          }
        }
        if (buf.trim()) say(buf.trim());
        if (silent) reply = "";
      } catch (e) { ok = false; error = (e as Error).message; }
      return did;
    });
    void append({ source: "teddy", who: (who || "Teddy").slice(0, 40), asked: text.slice(0, 300), reply: (silent ? "(silence: not meant for Teddy)" : reply || error || "").slice(0, 500), did, ms: Date.now() - t0, ok });
    return { ok, error, reply, did };
  };

  if (!streaming) {
    const r = await run(() => {});
    if (!r.ok) return Response.json({ error: r.error, conversation: id }, { status: 502 });
    return Response.json({ text: r.reply, conversation: id, did: r.did });
  }
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const r = await run(emit);
      emit({ done: true, text: r.reply, conversation: id, did: r.did, error: r.error });
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" } });
}
