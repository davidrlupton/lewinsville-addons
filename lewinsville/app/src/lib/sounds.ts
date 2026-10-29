// Recorded sounds ("Good morning, kids!") kept on the hub and played on the house speakers.
// Files live under HA's media folder so Home Assistant can hand them to the Sonos as a media-source item:
//   /media/lewinsville/sounds/<id>.mp3  +  index.json  (the add-on maps media:rw)
// Recordings arrive from the browser as mp4/aac (iPhone) or webm/opus (Chrome); ffmpeg in the add-on image
// turns everything into mp3 so every speaker can play it.
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { hub } from "./ha";

export type Sound = { id: string; name: string; who: string; created: number; seconds: number | null; file: string };
export const SPEAKERS: Record<string, { label: string; entity: string }> = {
  living: { label: "Living room", entity: "media_player.sonos_living_room_sonos_living_room" },
  teddy: { label: "Teddy", entity: "media_player.jarvis_media_player" },
};

const DIR = process.env.SOUNDS_DIR || "/media/lewinsville/sounds";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const INDEX = () => path.join(DIR, "index.json");
const run = promisify(execFile);

export async function listSounds(): Promise<Sound[]> {
  try { return JSON.parse(await fs.readFile(INDEX(), "utf8")) as Sound[]; } catch { return []; }
}
async function save(list: Sound[]) { await fs.mkdir(DIR, { recursive: true }); await fs.writeFile(INDEX(), JSON.stringify(list, null, 2)); }

/** Store an uploaded or recorded clip, converting to mp3 when ffmpeg is available. */
export async function addSound(name: string, who: string, data: Buffer, mime: string): Promise<Sound> {
  await fs.mkdir(DIR, { recursive: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const inExt = mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "bin";
  const raw = path.join(DIR, `${id}.${inExt}`);
  await fs.writeFile(raw, data);
  let file = `${id}.mp3`, seconds: number | null = null;
  try {
    await run(FFMPEG, ["-y", "-loglevel", "error", "-i", raw, "-vn", "-ac", "1", "-ar", "44100", "-b:a", "96k", path.join(DIR, file)]);
    const { stdout } = await run(FFMPEG, ["-i", path.join(DIR, file), "-f", "null", "-"]).catch((e) => ({ stdout: String(e.stderr ?? "") }));
    const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(String(stdout)); if (m) seconds = Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]);
    await fs.unlink(raw);
  } catch {
    // No ffmpeg (dev PC) or a conversion failure: keep the original if a speaker can play it.
    if (inExt === "mp3" || inExt === "m4a") file = `${id}.${inExt}`; else { await fs.unlink(raw).catch(() => {}); throw new Error("Could not convert that recording"); }
  }
  const s: Sound = { id, name: name.trim().slice(0, 60) || "Untitled", who, created: Date.now(), seconds, file };
  await save([s, ...(await listSounds())]);
  return s;
}

export async function removeSound(id: string) {
  const list = await listSounds(); const s = list.find((x) => x.id === id); if (!s) return false;
  await fs.unlink(path.join(DIR, s.file)).catch(() => {});
  await save(list.filter((x) => x.id !== id));
  return true;
}

/** Play a sound on one of the house speakers through Home Assistant (announcement, so music resumes after). */
export async function playSound(id: string, where: string) {
  const s = (await listSounds()).find((x) => x.id === id); if (!s) throw new Error("No such sound");
  const sp = SPEAKERS[where]; if (!sp) throw new Error("No such speaker");
  const h = hub(); await h.connect();
  await h.callService("media_player", "play_media", {
    media_content_id: `media-source://media_source/local/lewinsville/sounds/${s.file}`, media_content_type: "music", announce: true,
  }, { entity_id: sp.entity });
  return `${s.name} on ${sp.label}`;
}
