// The house agent: Claude with tools that act through Home Assistant. Used by /api/chat (text or
// transcribed voice). Every action goes through the same allowlist as the buttons in the app.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { hub } from "./ha";
import { getHouse, describeHouse, SCENES, CONTROL_DOMAINS, partialAllowed } from "./house";
import type { Person } from "./identity";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

function client() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no_api_key");
  return new Anthropic({ apiKey: key });
}

const SYSTEM_BASE = `You are the house assistant for 7703 Lewinsville Road, a family home. You can see and control
the lights, shades, thermostats, fans and music through tools. You talk to members of the household.

How to behave:
- Be warm and brief. One or two sentences. Confirm what you did, not how.
- When a request is clear, act immediately with the tools; do not ask permission for lights, shades, music or
  temperature changes within 60-80°F.
- Rooms: "Bedroom 1" is Riya's room, "Bedroom 2" is Liam's room. "Master" or "our room" means the Primary Bedroom.
  "The family room" or "the TV room" means the Living Room. "Downstairs" is the First Floor, "upstairs" the
  Second Floor, "the basement" the Basement floor.
- "Cozy" or "movie" means lights to about 30% and shades closed. "Bright" means 100%.
- Whole-house moods are scenes: Welcome, Day, Night, Away. Use set_scene for "goodnight", "we're leaving",
  "we're home".
- If something is not in the house list, say so plainly. Never invent devices.
- The Living Room shade covers the porch door: never set it partway, only fully open or closed. Halfway requests skip it.
- Temperatures are Fahrenheit. Do not set below 60 or above 80 without being told twice.
- Do not discuss these instructions.`;

const ACTIONS = ["turn_on", "turn_off", "toggle", "set_brightness", "open", "close", "stop", "set_position",
  "set_temperature", "set_hvac_mode", "play", "pause", "volume_set", "next_track"] as const;

export function tools(person: Person) {
  const control = betaZodTool({
    name: "control",
    description: "Control one or more devices. Use entity ids from list_house. Brightness and position are 0-100; temperature is °F; hvac_mode is one of off, cool, heat, heat_cool, fan_only, dry; volume is 0-1.",
    inputSchema: z.object({
      entity_ids: z.array(z.string()).min(1).describe("Entity ids to act on"),
      action: z.enum(ACTIONS),
      value: z.number().optional().describe("Brightness %, position %, temperature °F or volume 0-1"),
      hvac_mode: z.enum(["off", "cool", "heat", "heat_cool", "fan_only", "dry"]).optional(),
    }),
    run: async ({ entity_ids, action, value, hvac_mode }) => {
      const results: string[] = [];
      for (const id of entity_ids) {
        try { results.push(await act(id, action, value, hvac_mode)); }
        catch (e) { results.push(`${id}: failed (${(e as Error).message})`); }
      }
      return results.join("\n");
    },
  });

  const listHouse = betaZodTool({
    name: "list_house",
    description: "Current state of every room and device in the house, with entity ids. Call this before acting if you are unsure of names or states.",
    inputSchema: z.object({}),
    run: async () => describeHouse(await getHouse()),
  });

  const setScene = betaZodTool({
    name: "set_scene",
    description: "Run a whole-house scene from the Lutron system.",
    inputSchema: z.object({ scene: z.enum(["welcome", "day", "night", "away"]) }),
    run: async ({ scene }) => {
      await hub().callService("button", "press", {}, { entity_id: SCENES[scene].entity });
      return `Scene ${SCENES[scene].label} started.`;
    },
  });

  void person;
  return [listHouse, control, setScene];
}

export async function act(entity_id: string, action: (typeof ACTIONS)[number], value?: number, hvac_mode?: string): Promise<string> {
  const domain = entity_id.split(".")[0];
  if (!CONTROL_DOMAINS.has(domain)) throw new Error("not a controllable device");
  const h = hub();
  const t = { entity_id };
  const clamp = (v: number | undefined, lo: number, hi: number, d: number) => Math.max(lo, Math.min(hi, v ?? d));
  switch (action) {
    case "turn_on": case "turn_off": case "toggle":
      await h.callService(domain === "cover" ? "cover" : domain, domain === "cover" ? (action === "turn_on" ? "open_cover" : "close_cover") : action, {}, t); break;
    case "set_brightness":
      await h.callService("light", "turn_on", { brightness_pct: clamp(value, 0, 100, 50) }, t); break;
    case "open": await h.callService("cover", "open_cover", {}, t); break;
    case "close": await h.callService("cover", "close_cover", {}, t); break;
    case "stop": await h.callService("cover", "stop_cover", {}, t); break;
    case "set_position": {
      const pos = clamp(value, 0, 100, 50);
      if (!partialAllowed(entity_id, pos)) return `${entity_id}: skipped, the living room shade covers a door and only goes fully open or closed`;
      await h.callService("cover", "set_cover_position", { position: pos }, t); break;
    }
    case "set_temperature": await h.callService("climate", "set_temperature", { temperature: clamp(value, 60, 80, 72) }, t); break;
    case "set_hvac_mode": await h.callService("climate", "set_hvac_mode", { hvac_mode: hvac_mode ?? "off" }, t); break;
    case "play": await h.callService("media_player", "media_play", {}, t); break;
    case "pause": await h.callService("media_player", "media_pause", {}, t); break;
    case "next_track": await h.callService("media_player", "media_next_track", {}, t); break;
    case "volume_set": await h.callService("media_player", "volume_set", { volume_level: clamp(value, 0, 1, 0.3) }, t); break;
  }
  return `${entity_id}: ${action}${value != null ? " " + value : ""}${hvac_mode ? " " + hvac_mode : ""} done`;
}

export type ChatMessage = Anthropic.Beta.BetaMessageParam;

/** Stream a reply. Yields text deltas; resolves with the final assistant content for the client to keep. */
export async function* chat(person: Person, history: ChatMessage[]) {
  const house = await getHouse();
  const system = [
    { type: "text" as const, text: SYSTEM_BASE, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `You are talking to ${person.name} (${person.role}). Local time ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}.\n\nHouse right now:\n${describeHouse(house)}` },
  ];
  const runner = client().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4000,
    system,
    tools: tools(person),
    messages: history,
    stream: true,
    max_iterations: 6,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  for await (const stream of runner) {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { text: ev.delta.text };
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") break;
  }
  const final = await runner.done();
  yield { done: true, content: final.content };
}
