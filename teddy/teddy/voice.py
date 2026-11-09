"""Teddy's mouth and brain connections: Home Assistant Cloud TTS (Ryan, en-GB) fetched through the Supervisor
proxy as 16 kHz mono WAV, the Sonos snapshot/volume/restore around each reply, and the call to the portal's
/api/converse (the one brain), streamed sentence by sentence so speaking starts before the reply is finished."""
import asyncio, json, logging, os, struct, threading, urllib.request, urllib.error
from datetime import datetime

log = logging.getLogger("teddy.voice")
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
CORE = os.environ.get("HA_CORE_URL", "http://supervisor/core")
PORTAL = "http://90b47cbd-lewinsville:3000"   # the portal add-on on the Supervisor network


def _http(method: str, url: str, body: dict | None = None, headers: dict | None = None, timeout: float = 30) -> tuple[int, bytes]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def pcm_of(wav: bytes) -> bytes | None:
    """The sample data of a 16 kHz mono 16-bit RIFF WAV, or None if it is anything else."""
    if wav[:4] != b"RIFF" or wav[8:12] != b"WAVE": return None
    i, fmt_ok = 12, False
    while i + 8 <= len(wav):
        cid, size = wav[i:i + 4], struct.unpack("<I", wav[i + 4:i + 8])[0]
        if cid == b"fmt ":
            tag, ch, rate, _, _, bits = struct.unpack("<HHIIHH", wav[i + 8:i + 24])
            fmt_ok = (tag, ch, rate, bits) == (1, 1, 16000, 16)
            if not fmt_ok: log.error("unexpected wav format tag=%s ch=%s rate=%s bits=%s", tag, ch, rate, bits)
        elif cid == b"data":
            return wav[i + 8:i + 8 + size] if fmt_ok else None
        i += 8 + size + (size & 1)
    return None


class Voice:
    def __init__(self, opt):
        self.opt = opt
        self.ha_headers = {"Authorization": f"Bearer {TOKEN}"}

    # ---- Home Assistant ---------------------------------------------------------------------------
    async def ha(self, method: str, path: str, body: dict | None = None, timeout: float = 30) -> tuple[int, bytes]:
        return await asyncio.to_thread(_http, method, f"{CORE}{path}", body, self.ha_headers, timeout)

    async def service(self, domain: str, service: str, data: dict):
        st, body = await self.ha("POST", f"/api/services/{domain}/{service}", data)
        if st >= 300: log.warning("%s.%s -> %s %s", domain, service, st, body[:200])

    async def tts(self, text: str) -> bytes | None:
        """A WAV of `text` in Teddy's voice, or None. HA ignores the engine's own audio_output here and serves
        MP3; its preferred_* options make it transcode. Without them aplay played MP3 bytes as raw PCM: white
        noise (2026-11-08)."""
        payload = {"engine_id": "tts.home_assistant_cloud", "message": text, "language": "en-GB",
                   "options": {"voice": self.opt("tts_voice", "RyanNeural"), "preferred_format": "wav",
                               "preferred_sample_rate": 16000, "preferred_sample_channels": 1, "preferred_sample_bytes": 2}}
        st, body = await self.ha("POST", "/api/tts_get_url", payload)
        if st >= 300:
            log.warning("tts_get_url -> %s %s", st, body[:200]); return None
        path = json.loads(body)["path"]
        st, audio = await self.ha("GET", path)
        if st >= 300 or len(audio) < 64:
            log.warning("tts fetch -> %s (%d bytes)", st, len(audio)); return None
        if audio[:4] != b"RIFF":
            log.error("tts returned %r, not WAV; refusing to play it", audio[:4]); return None
        return audio

    # ---- Sonos ------------------------------------------------------------------------------------
    def quiet_now(self) -> bool:
        now = datetime.now().strftime("%H:%M")
        a, b = self.opt("quiet_from", "21:00"), self.opt("quiet_until", "08:00")
        return (a <= now or now < b) if a > b else (a <= now < b)

    async def before_speaking(self):
        sonos = self.opt("sonos_entity", "")
        if not sonos: return
        vol = self.opt("volume_quiet", 0.25) if self.quiet_now() else self.opt("volume_day", 0.45)
        await self.service("sonos", "snapshot", {"entity_id": sonos})
        await self.service("media_player", "volume_set", {"entity_id": sonos, "volume_level": vol})

    async def after_speaking(self):
        sonos = self.opt("sonos_entity", "")
        if not sonos: return
        await self.service("sonos", "restore", {"entity_id": sonos})

    # ---- the brain --------------------------------------------------------------------------------
    async def converse_stream(self, text: str, conversation: str | None):
        """Yield the portal's NDJSON objects: {"sentence": ...} as they come, then {"done": true, ...}."""
        url = PORTAL + "/api/converse?stream=1"
        headers = {"Content-Type": "application/json", "x-teddy-token": self.opt("teddy_token", "")}
        q: asyncio.Queue = asyncio.Queue(); loop = asyncio.get_running_loop()
        def worker():
            try:
                req = urllib.request.Request(url, data=json.dumps({"text": text, "conversation": conversation, "who": "Living Room Ear"}).encode(), method="POST", headers=headers)
                with urllib.request.urlopen(req, timeout=50) as r:
                    for line in r:
                        if line.strip(): loop.call_soon_threadsafe(q.put_nowait, json.loads(line))
            except urllib.error.HTTPError as e:
                loop.call_soon_threadsafe(q.put_nowait, {"done": True, "error": f"{e.code} {e.read()[:200]!r}"})
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait, {"done": True, "error": f"{type(e).__name__}: {e}"})
            loop.call_soon_threadsafe(q.put_nowait, None)
        threading.Thread(target=worker, daemon=True).start()
        while (m := await q.get()) is not None:
            yield m


class Player:
    """One aplay for a whole reply: sentences are appended as raw PCM, so there is no gap between them."""
    def __init__(self): self.p = None
    async def start(self):
        self.p = await asyncio.create_subprocess_exec("aplay", "-q", "-r", "16000", "-c", "1", "-f", "S16_LE", "-t", "raw", "-",
                                                      stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    async def write(self, pcm: bytes):
        try: self.p.stdin.write(pcm); await self.p.stdin.drain()
        except (BrokenPipeError, ConnectionResetError): log.warning("player pipe closed")
    async def finish(self):
        try: self.p.stdin.close()
        except Exception: pass
        await self.p.wait()
