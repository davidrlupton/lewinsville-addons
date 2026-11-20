// The house as the app and Claude see it: rooms grouped by floor, each with its controllable devices.
import { hub, type HassEntity } from "./ha";

export const CONTROL_DOMAINS = new Set(["light", "cover", "switch", "fan", "climate", "media_player"]);
export type Device = { id: string; name: string; room: string; floor: string; domain: string; state: string; attrs: Record<string, unknown> };
export type Room = { id: string; name: string; floor: string; devices: Device[] };
export type House = { floors: string[]; rooms: Room[]; updated: number };

export const FLOOR_ORDER = ["First Floor", "Second Floor", "Loft", "Basement", "Exterior"];
// Things that are controllable in HA but noise for a person: keypad LEDs, Sonos tuning switches,
// the Airzone zone on/off switches (the thermostat card covers them), add-on switches.
const HIDE = /(_led$|crossfade|loudness|night_sound|speech_enhancement|status_light|surround|touch_controls|autoplay|^switch\.(master|basement|2nd_floor|living_room)$|^switch\.terminal_ssh|subwoofer|^media_player\.denon_living_2$|home_assistant_voice|jarvis)/;

const KEEP = ["brightness", "color_temp_kelvin", "current_position", "current_temperature", "temperature", "hvac_action", "hvac_modes",
  "current_humidity", "fan_mode", "media_title", "media_artist", "volume_level", "source", "source_list", "percentage", "min_temp", "max_temp", "supported_features",
  "hs_color", "color_mode", "supported_color_modes", "min_color_temp_kelvin", "max_color_temp_kelvin"];
function pick(a: Record<string, unknown>) { const o: Record<string, unknown> = {}; for (const k of KEEP) if (k in a) o[k] = a[k]; return o; }
function shortName(full: string, room: string) {
  const n = full.startsWith(room + " ") ? full.slice(room.length + 1) : full;
  return n || full;
}

export async function getHouse(): Promise<House> {
  const h = hub();
  await h.connect();
  await h.refreshRegistry();
  const floorName = new Map(h.floors.map((f) => [f.floor_id, f.name]));
  const devArea = new Map(h.devReg.map((d) => [d.id, d.area_id]));
  const rooms = new Map<string, Room>();
  for (const a of h.areas) rooms.set(a.area_id, { id: a.area_id, name: a.name, floor: floorName.get(a.floor_id ?? "") ?? "Other", devices: [] });
  for (const e of h.entReg) {
    if (e.disabled_by || e.hidden_by) continue;
    const dom = e.entity_id.split(".")[0];
    if (!CONTROL_DOMAINS.has(dom) || HIDE.test(e.entity_id)) continue;
    const areaId = e.area_id ?? (e.device_id ? devArea.get(e.device_id) : null);
    const room = areaId ? rooms.get(areaId) : undefined;
    if (!room) continue;
    const st: HassEntity | undefined = h.entities[e.entity_id];
    if (!st || st.state === "unavailable") continue;
    const full = (st.attributes.friendly_name as string) ?? e.name ?? e.original_name ?? e.entity_id;
    room.devices.push({ id: e.entity_id, name: shortName(full, room.name), room: room.name, floor: room.floor, domain: dom, state: st.state, attrs: pick(st.attributes) });
  }
  const list = [...rooms.values()].filter((r) => r.devices.length).sort((a, b) =>
    (FLOOR_ORDER.indexOf(a.floor) - FLOOR_ORDER.indexOf(b.floor)) || a.name.localeCompare(b.name));
  const DOM_ORDER = ["climate", "light", "cover", "fan", "switch", "media_player"];
  for (const r of list) r.devices.sort((a, b) => (DOM_ORDER.indexOf(a.domain) - DOM_ORDER.indexOf(b.domain)) || a.name.localeCompare(b.name));
  return { floors: FLOOR_ORDER.filter((f) => list.some((r) => r.floor === f)), rooms: list, updated: Date.now() };
}

/** Compact text for the model: one line per room. */
export function describeHouse(house: House): string {
  const out: string[] = [];
  for (const f of house.floors) {
    out.push(`## ${f}`);
    for (const r of house.rooms.filter((r) => r.floor === f)) {
      out.push(`- ${r.name}: ` + r.devices.map((d) => {
        let s = d.state;
        if (d.domain === "light" && d.state === "on" && typeof d.attrs.brightness === "number") s += ` ${Math.round(d.attrs.brightness / 2.55)}%`;
        if (d.domain === "light" && d.state === "on" && d.attrs.color_mode === "hs" && Array.isArray(d.attrs.hs_color)) s += ` hue ${Math.round((d.attrs.hs_color as number[])[0])} sat ${Math.round((d.attrs.hs_color as number[])[1])}`;
        else if (d.domain === "light" && d.state === "on" && d.attrs.color_temp_kelvin) s += ` ${d.attrs.color_temp_kelvin}K`;
        if (d.domain === "light" && (d.attrs.supported_color_modes as string[] | undefined)?.includes("hs")) s += ", colour-capable";
        if (d.domain === "cover" && d.attrs.current_position != null) s = `${d.attrs.current_position}% open`;
        if (d.domain === "climate") s = `${d.state}; ${d.attrs.current_temperature}°F now, set ${d.attrs.temperature}°F, ${d.attrs.hvac_action ?? "idle"}`;
        return `${d.name} [${d.id}] (${s})`;
      }).join("; "));
    }
  }
  return out.join("\n");
}

// House rule (David, 2026-10-25): the Living Room shade covers the porch door, so it never goes to a
// partial position. Fully open or fully closed only.
export const NO_PARTIAL_COVERS = new Set(["cover.living_room_shade"]);
export function partialAllowed(entity_id: string, position: number) {
  return !(NO_PARTIAL_COVERS.has(entity_id) && position > 0 && position < 100);
}

// The Entertain area: the open-plan first floor where the family actually lives. Its moods are keypad buttons
// programmed in Lutron, so the app and the wall agree. Home Assistant named the button entities when the keypads
// were first imported (2026-10-24) and never renames them, so the ids below carry the OLD engravings; what each
// button does today (Designer, 2026-11-19) is the label. Kitchen "At Column" keypad 3 reads Bright / Entertain /
// Night / Off; the Living Room column has White, Warm and Media keypads.
export const ENTERTAIN = {
  rooms: ["Living Room", "Kitchen", "Dining Room", "Breakfast Room", "Foyer"],
  moods: {
    bright: { entity: "button.first_floor_kitchen_first_floor_kitchen_at_column_position_3_keypad_entertain", label: "Bright" },        // button 1
    entertain: { entity: "button.first_floor_kitchen_first_floor_kitchen_at_column_position_3_keypad_accent", label: "Entertain" },     // button 2
    night: { entity: "button.first_floor_kitchen_first_floor_kitchen_at_column_position_3_keypad_night", label: "Night" },              // button 3
    off: { entity: "button.first_floor_kitchen_first_floor_kitchen_at_column_position_3_keypad_shades", label: "Off" },                 // button 4, the Great Room Off scene
    movie: { entity: "button.first_floor_living_room_first_floor_living_room_at_column_position_3_keypad_button_1", label: "Movie" },
    warm: { entity: "button.first_floor_living_room_first_floor_living_room_at_column_position_2_keypad_button_1", label: "Warm" },
    accent: { entity: "button.first_floor_living_room_first_floor_living_room_at_column_position_3_keypad_button_3", label: "Accent" },
    shades: { entity: "button.first_floor_living_room_first_floor_living_room_at_column_position_3_keypad_button_4", label: "Shades" }, // every shade that lights the first floor: open, stop, close, stop
  } as Record<string, { entity: string; label: string }>,
};
/** The LED of the Kitchen keypad's Entertain button (button 2): on while the family is entertaining. */
export const ENTERTAINING_LED = "switch.first_floor_kitchen_first_floor_kitchen_at_column_position_3_keypad_accent_led";
export function supportsColor(d: Device) { return ((d.attrs.supported_color_modes as string[] | undefined) ?? []).some((m) => m === "hs" || m === "rgb" || m === "xy"); }

// Whole-house scenes are buttons on the Foyer "House" keypad, programmed in Lutron: Welcome (button 1) and Away
// (button 4, the shared All Off scene: every light off, shades untouched; the Primary Bedroom's Good Night runs
// the same scene). Buttons 2 and 3 are Open Shades and Close Shades; the app's Shades card does that itself.
export const SCENES: Record<string, { entity: string; label: string }> = {
  welcome: { entity: "button.first_floor_foyer_first_floor_foyer_foyer_inside_position_3_keypad_welcome", label: "Welcome" },
  all_off: { entity: "button.first_floor_foyer_first_floor_foyer_foyer_inside_position_3_keypad_away", label: "All off" },
};
