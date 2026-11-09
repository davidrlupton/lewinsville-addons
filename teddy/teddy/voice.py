"""Teddy's mouth and brain connections: Home Assistant Cloud TTS (Ryan, en-GB) fetched through the Supervisor
proxy and played with aplay on the hub's default output (the Lenovo line-out into the Sonos Amp), the Sonos
snapshot/volume/restore around each reply, and the call to the portal's /api/converse (the one brain)."""
import asyncio, json, logging, os, time, urllib.request, urllib.error
from datetime import datetime

log = logging.getLogger("teddy.voice")
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
CORE = os.environ.get("HA_CORE_URL", "http://supervisor/core")


def _http(method: str, url: str, body: dict | None = None, headers: dict | None = None, timeout: float = 30) -> tuple[int, bytes]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


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
        """A WAV of `text` in Teddy's voice, or None."""
        payload = {"engine_id": self.opt("tts_engine", "tts.home_assistant_cloud"), "message": text,
                   "language": self.opt("tts_language", "en-GB"),
                   # HA ignores the engine's own audio_output here and serves MP3; its preferred_* options make it
                   # transcode to what aplay can take. Without them aplay played MP3 bytes as raw PCM: white noise (2026-11-08).
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
    async def converse(self, text: str, conversation: str | None) -> dict:
        url = self.opt("portal_url", "http://90b47cbd-lewinsville:3000").rstrip("/") + "/api/converse"
        headers = {"x-teddy-token": self.opt("teddy_token", "")}
        t0 = time.monotonic()
        try:
            st, body = await asyncio.to_thread(_http, "POST", url, {"text": text, "conversation": conversation}, headers, 50)
            out = json.loads(body or b"{}")
        except Exception as e:
            st, out = 0, {"error": f"{type(e).__name__}: {e}"}
        out["ms"] = int((time.monotonic() - t0) * 1000); out["status"] = st
        if st != 200: log.warning("converse -> %s %s", st, out.get("error"))
        return out


async def play_wav(wav: bytes):
    """Play through the hub's default output (aplay via the PulseAudio ALSA plugin)."""
    p = await asyncio.create_subprocess_exec("aplay", "-q", "-", stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        p.stdin.write(wav); await p.stdin.drain(); p.stdin.close()
    except (BrokenPipeError, ConnectionResetError): pass
    await p.wait()
