// The house as the app and Claude see it: rooms grouped by floor, each with its controllable devices.
import { hub, type HassEntity } from "./ha";

export const CONTROL_DOMAINS = new Set(["light", "cover", "switch", "fan", "climate", "media_player"]);
export type Device = { id: string; name: string; room: string; floor: string; domain: string; state: string; attrs: Record<string, unknown> };
export type Room = { id: string; name: string; floor: string; devices: Device[] };
export type House = { floors: string[]; rooms: Room[]; updated: number };

export const FLOOR_ORDER = ["First Floor", "Second Floor", "Loft", "Basement", "Exterior"];
// Things that are controllable in HA but noise for a person: keypad LEDs, Sonos tuning switches,
// the Airzone zone on/off switches (the thermostat card covers them), add-on switches.
const HIDE = /(_led$|crossfade|loudness|night_sound|speech_enhancement|status_light|surround|touch_controls|autoplay|^switch\.(master|basement|2nd_floor|living_room)$|^switch\.terminal_ssh|subwoofer|^media_player\.denon_living_2$)/;

const KEEP = ["brightness", "color_temp_kelvin", "current_position", "current_temperature", "temperature", "hvac_action", "hvac_modes",
  "current_humidity", "fan_mode", "media_title", "media_artist", "volume_level", "source", "source_list", "percentage", "min_temp", "max_temp", "supported_features"];
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

// Whole-house scenes are buttons on the Foyer keypad, programmed in Lutron.
export const SCENES: Record<string, { entity: string; label: string }> = {
  welcome: { entity: "button.foyer_foyer_inside_position_3_keypad_welcome", label: "Welcome" },
  day: { entity: "button.foyer_foyer_inside_position_3_keypad_day", label: "Day" },
  night: { entity: "button.foyer_foyer_inside_position_3_keypad_night", label: "Night" },
  away: { entity: "button.foyer_foyer_inside_position_3_keypad_away", label: "Away" },
};
