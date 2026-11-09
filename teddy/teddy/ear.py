"""Teddy's ear (PLAN.md Phase 5): one loop on the Jabra.

  wake    : stream the microphone to the openWakeWord add-on over Wyoming until it reports "hey_teddy"
  listen  : cut one utterance with Silero VAD (speech start within listen_timeout, end after silence_seconds)
  stt     : stream the same audio to Home Assistant's speech-to-text stage of the chosen pipeline, get text
  think   : POST the text to the portal's /api/converse (Claude with the house tools), same thread for follow-ups
  speak   : Home Assistant Cloud TTS (Ryan) through the Lenovo line-out into the Sonos, volume by time of day
  follow  : keep listening followup_seconds after each reply; no wake word needed; silence ends the exchange
  log     : one JSON line per turn in /share/lewinsville/teddy-ear.jsonl with per-stage timings

With speak=false it is step 1 of the plan: hear, transcribe, log, nothing more.
"""
import asyncio, json, logging, os, sys, time, wave
from collections import deque
from datetime import datetime

import websockets
from aiohttp import web
from pysilero_vad import SileroVoiceActivityDetector
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.client import AsyncTcpClient
from wyoming.wake import Detect, Detection

from .voice import Voice, Player, pcm_of

OPT = json.load(open("/data/options.json")) if os.path.exists("/data/options.json") else {}
def opt(k, d): return OPT.get(k, d)

RATE, WIDTH, CH = 16000, 2, 1
WAKE_HOST, WAKE_PORT, WAKE_WORD = "core-openwakeword", 10400, "hey_teddy"   # the openWakeWord add-on with our model
PIPELINE = "Lewinsville"          # whose STT engine we borrow
LISTEN_TIMEOUT, MAX_SECONDS = 6.0, 12.0
LOG_DIR = "/share/lewinsville"
CLIP_DIR = f"{LOG_DIR}/teddy-clips"
HA_WS = os.environ.get("HA_WS_URL", "ws://supervisor/core/websocket")
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")

log = logging.getLogger("teddy")
logging.basicConfig(level=logging.DEBUG if opt("debug", True) else logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logging.getLogger("websockets").setLevel(logging.INFO)


async def set_house_time():
    """The container runs in UTC; the quiet-hours schedule and the log need house time, so take HA's zone.
    Core may still be starting when we do (a 502 on 2026-11-08 left the clock on UTC), so keep trying for a while."""
    import urllib.request
    for attempt in range(20):
        try:
            req = urllib.request.Request("http://supervisor/core/api/config", headers={"Authorization": f"Bearer {TOKEN}"})
            with urllib.request.urlopen(req, timeout=10) as r: tz = json.load(r).get("time_zone")
            if tz: os.environ["TZ"] = tz; time.tzset(); log.info("house time zone %s", tz); return
        except Exception as e:
            if attempt == 19: log.warning("time zone: %s; staying on UTC", e)
        await asyncio.sleep(15)


class Mic:
    """arecord through the hub's PulseAudio, handed out in VAD-sized frames (512 samples, 32 ms)."""
    def __init__(self, frame_bytes: int):
        self.frame = frame_bytes; self.proc = None
    async def start(self):
        self.proc = await asyncio.create_subprocess_exec(
            "arecord", "-q", "-r", str(RATE), "-c", str(CH), "-f", "S16_LE", "-t", "raw",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        log.info("microphone open (arecord pid %s)", self.proc.pid)
    async def read(self) -> bytes:
        return await self.proc.stdout.readexactly(self.frame)


class Ear:
    def __init__(self):
        self.vad = SileroVoiceActivityDetector()
        self.frame = self.vad.chunk_bytes()           # 1024 bytes = 32 ms
        self.frame_s = self.frame / (RATE * WIDTH)
        self.mic = Mic(self.frame)
        self.preroll = deque(maxlen=int(1.0 / self.frame_s))  # last second, kept for the clip
        self.pipeline_id = None
        self.voice = Voice(opt)
        self.say_queue: asyncio.Queue = asyncio.Queue()   # texts other parts of the house ask Teddy to speak (the puck's brain)
        os.makedirs(CLIP_DIR, exist_ok=True)

    # ---- wake -------------------------------------------------------------------------------------
    async def wait_for_wake(self) -> float:
        while True:
            try:
                client = AsyncTcpClient(WAKE_HOST, WAKE_PORT)
                await client.connect()
                await client.write_event(Detect(names=[WAKE_WORD]).event())
                await client.write_event(AudioStart(rate=RATE, width=WIDTH, channels=CH, timestamp=0).event())
                detected = asyncio.Event()
                async def reader():
                    while True:
                        ev = await client.read_event()
                        if ev is None: return
                        if Detection.is_type(ev.type):
                            d = Detection.from_event(ev)
                            log.info("wake: %s", d.name); detected.set(); return
                rt = asyncio.create_task(reader())
                ts = 0
                while not detected.is_set() and self.say_queue.empty():
                    frame = await self.mic.read()
                    self.preroll.append(frame)
                    await client.write_event(AudioChunk(rate=RATE, width=WIDTH, channels=CH, audio=frame, timestamp=ts).event())
                    ts += int(self.frame_s * 1000)
                    if rt.done() and not detected.is_set():
                        raise ConnectionError("wake server closed the stream")
                try: await client.write_event(AudioStop(timestamp=ts).event())
                except Exception: pass
                rt.cancel()
                await client.disconnect()
                return time.monotonic() if detected.is_set() else None   # None: something to say first
            except Exception as e:
                log.warning("wake stage: %s; retrying in 3 s", e)
                await asyncio.sleep(3)

    # ---- speech to text through HA ----------------------------------------------------------------
    _n = 0
    async def call(self, ws, msg):
        Ear._n += 1; msg["id"] = Ear._n
        await ws.send(json.dumps(msg))
        while True:
            m = json.loads(await ws.recv())
            if m.get("id") == msg["id"] and m.get("type") == "result":
                if not m["success"]: raise RuntimeError(m.get("error"))
                return m["result"]

    async def pipeline(self, ws) -> str | None:
        if self.pipeline_id is None:
            r = await self.call(ws, {"type": "assist_pipeline/pipeline/list"})
            self.pipeline_id = next((p["id"] for p in r["pipelines"] if p["name"] == PIPELINE), "")
            if not self.pipeline_id: log.warning("pipeline %r not found, using the preferred one", PIPELINE)
        return self.pipeline_id or None

    async def transcribe(self, frames: "asyncio.Queue[bytes | None]", timings: dict, done: asyncio.Event) -> dict:
        """Stream frames (None = end) to HA's STT stage. Returns {"text": ...} and/or {"error": ...}.
        Sets `done` as soon as HA has a result, so the listener stops even if our own VAD still hears the room."""
        out = {}
        try:
            async with websockets.connect(HA_WS, max_size=2**22) as ws:
                await ws.recv()
                await ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
                ok = json.loads(await ws.recv()); assert ok["type"] == "auth_ok", ok
                pid = await self.pipeline(ws)
                Ear._n += 1
                run = {"id": Ear._n, "type": "assist_pipeline/run", "start_stage": "stt", "end_stage": "stt",
                       "input": {"sample_rate": RATE}, "timeout": 30}
                if pid: run["pipeline"] = pid
                await ws.send(json.dumps(run))
                handler = None
                while handler is None:
                    m = json.loads(await ws.recv())
                    if m.get("type") == "result" and not m.get("success"): raise RuntimeError(m.get("error"))
                    if m.get("type") == "event" and m["event"]["type"] == "run-start":
                        handler = m["event"]["data"]["runner_data"]["stt_binary_handler_id"]
                prefix = bytes([handler])
                async def pump():
                    try:
                        while not done.is_set():
                            f = await frames.get()
                            if f is None:
                                await ws.send(prefix); return
                            await ws.send(prefix + f)
                    except Exception: pass   # HA may have closed the run already; the result is what matters
                pt = asyncio.create_task(pump())
                while True:
                    m = json.loads(await asyncio.wait_for(ws.recv(), 20))
                    if m.get("type") != "event": continue
                    ev = m["event"]
                    if ev["type"] == "stt-end":
                        out["text"] = (ev["data"].get("stt_output") or {}).get("text", "").strip()
                        timings["stt_done"] = time.monotonic(); done.set()
                    elif ev["type"] == "error":
                        out["error"] = ev["data"].get("message") or ev["data"].get("code"); done.set()
                    elif ev["type"] == "run-end":
                        break
                await pt
        except Exception as e:
            out.setdefault("error", f"{type(e).__name__}: {e}")
        done.set()
        return out

    # ---- one utterance -----------------------------------------------------------------------------
    async def listen_and_transcribe(self, since: float, wait_s: float) -> dict:
        timings = {"wake": since}
        frames: asyncio.Queue = asyncio.Queue()
        done = asyncio.Event()
        stt = None   # HA's cloud STT gives up on a stream that starts with ~3 s of silence, so it is opened
                     # only when speech begins and is handed the half second before it (2026-11-08).
        clip = list(self.preroll)
        self.vad.reset()
        silence = opt("silence_seconds", 0.55); max_s = MAX_SECONDS
        lead = int(0.5 / self.frame_s)
        speaking = False; quiet = 0.0; started = time.monotonic(); speech_start = None
        while True:
            frame = await self.mic.read()
            clip.append(frame)
            if speaking: await frames.put(frame)
            p = self.vad(frame)
            now = time.monotonic()
            if not speaking:
                if p >= 0.5:
                    speaking = True; speech_start = now; timings["speech_start"] = now
                    for f in clip[-lead:]: await frames.put(f)
                    stt = asyncio.create_task(self.transcribe(frames, timings, done))
                    log.debug("speech started %.2fs in", now - since)
                elif now - started > wait_s:
                    log.info("nothing said within %.0fs", wait_s); break
            else:
                quiet = quiet + self.frame_s if p < 0.3 else 0.0
                if quiet >= silence or now - speech_start > max_s or done.is_set():
                    timings["speech_end"] = min(now - quiet, timings.get("stt_done", now))
                    log.debug("speech ended, %.2fs of speech%s", timings["speech_end"] - speech_start, " (HA finished first)" if done.is_set() and quiet < silence else ""); break
        await frames.put(None)
        if not speaking or stt is None:
            return {"timings": timings}
        res = await stt
        res["timings"] = timings
        if opt("save_clips", True):
            name = datetime.now().strftime("%Y%m%d-%H%M%S") + ".wav"
            with wave.open(f"{CLIP_DIR}/{name}", "wb") as w:
                w.setnchannels(CH); w.setsampwidth(WIDTH); w.setframerate(RATE); w.writeframes(b"".join(clip))
            res["clip"] = name
        return res

    # ---- speaking ----------------------------------------------------------------------------------
    async def drain(self):
        """Keep the microphone flowing (and the pre-roll fresh) while we are not listening."""
        try:
            while True: self.preroll.append(await self.mic.read())
        except asyncio.CancelledError: pass

    async def speak_stream(self, sentences, timings: dict):
        """Synthesise each sentence as it arrives and play them back to back. The Sonos handoff runs while the
        first sentence is still being written, so the first sound follows the first sentence, not the whole reply."""
        d = asyncio.create_task(self.drain())
        prep = asyncio.create_task(self.voice.before_speaking())
        player = Player(); await player.start()
        q: asyncio.Queue = asyncio.Queue()
        async def feed():
            while (t := await q.get()) is not None:
                wav = await t
                pcm = pcm_of(wav) if wav else None
                if not pcm: log.warning("no audio for a sentence"); continue
                await prep
                timings.setdefault("first_audio", time.monotonic())
                await player.write(pcm)
        feeder = asyncio.create_task(feed())
        try:
            async for s in sentences:
                timings.setdefault("first_sentence", time.monotonic())
                await q.put(asyncio.create_task(self.voice.tts(s)))
        finally:
            await q.put(None); await feeder
            await prep
            await player.finish()
            await asyncio.sleep(0.3)   # let the room settle before listening again
            await self.voice.after_speaking()
            d.cancel(); await d

    # ---- speaking for others: POST /say {"text": ...} from the puck's brain (teddy_brain in HA) -------------
    async def say_pending(self):
        while not self.say_queue.empty():
            text, fut = self.say_queue.get_nowait()
            t = {}
            async def one():
                yield text
            try:
                await self.speak_stream(one(), t)
                self.record({"at": datetime.now().isoformat(timespec="seconds"), "say": text[:300], "first_audio_ms": None})
                if not fut.done(): fut.set_result(True)
            except Exception as e:
                log.warning("say: %s", e)
                if not fut.done(): fut.set_exception(e)
        self.preroll.clear()

    async def serve(self):
        async def say(req: web.Request):
            if req.headers.get("x-teddy-token", "") != opt("teddy_token", ""): return web.json_response({"error": "forbidden"}, status=403)
            body = await req.json(); text = str(body.get("text") or "").strip()
            if not text: return web.json_response({"error": "no_text"}, status=400)
            fut = asyncio.get_running_loop().create_future()
            await self.say_queue.put((text, fut))
            try: await asyncio.wait_for(fut, 60)
            except Exception as e: return web.json_response({"error": str(e)}, status=502)
            return web.json_response({"ok": True})
        app = web.Application(); app.add_routes([web.post("/say", say), web.get("/health", lambda r: web.json_response({"ok": True}))])
        runner = web.AppRunner(app); await runner.setup()
        await web.TCPSite(runner, "0.0.0.0", 8099).start()
        log.info("say endpoint on :8099")

    # ---- the loop ----------------------------------------------------------------------------------
    def record(self, rec: dict):
        log.info("turn: %s", json.dumps(rec))
        try:
            with open(f"{LOG_DIR}/teddy-ear.jsonl", "a", encoding="utf-8") as f: f.write(json.dumps(rec) + "\n")
        except OSError as e: log.warning("log write: %s", e)

    async def run(self):
        if not TOKEN: log.error("SUPERVISOR_TOKEN is empty: speech-to-text and speaking cannot work")
        asyncio.create_task(set_house_time())
        await self.mic.start()
        log.info("listening for %r via %s:%s; STT from pipeline %r; speak=%s", WAKE_WORD, WAKE_HOST, WAKE_PORT, PIPELINE, opt("speak", False))
        ms = lambda a, b: int((b - a) * 1000)
        asyncio.create_task(self.serve())
        while True:
            since = await self.wait_for_wake()
            if since is None:
                await self.say_pending(); continue
            conversation = None; wait_s = LISTEN_TIMEOUT; followup = False
            while True:
                res = await self.listen_and_transcribe(since, wait_s)
                t = res["timings"]
                rec = {"at": datetime.now().isoformat(timespec="seconds"), "followup": followup, "text": res.get("text"), "error": res.get("error"), "clip": res.get("clip"),
                       "speech_start_ms": ms(t["wake"], t["speech_start"]) if "speech_start" in t else None,
                       "speech_ms": ms(t["speech_start"], t["speech_end"]) if "speech_end" in t else None,
                       "stt_ms": ms(t["speech_end"], t["stt_done"]) if "stt_done" in t and "speech_end" in t else None}
                text = res.get("text")
                if not text or not opt("speak", False):
                    self.record(rec); break
                outcome = {}
                async def sentences():
                    async for m in self.voice.converse_stream(text, conversation):
                        if "sentence" in m: yield m["sentence"]
                        if m.get("done"):
                            outcome.update(m); t["think_done"] = time.monotonic()
                            if m.get("error") and not m.get("text"):
                                log.warning("brain: %s", m["error"]); yield "Sorry, I can't think just now. Try the switch or the app?"
                await self.speak_stream(sentences(), t)
                conversation = outcome.get("conversation", conversation)
                rec.update({"reply": outcome.get("text"), "did": outcome.get("did"), "brain_error": outcome.get("error"),
                            "first_sentence_ms": ms(t["speech_end"], t["first_sentence"]) if "first_sentence" in t and "speech_end" in t else None,
                            "think_ms": ms(t["speech_end"], t["think_done"]) if "think_done" in t and "speech_end" in t else None,
                            "first_audio_ms": ms(t["speech_end"], t["first_audio"]) if "first_audio" in t and "speech_end" in t else None})
                self.record(rec)
                follow_s = opt("followup_seconds", 8)
                if follow_s <= 0: break
                since = time.monotonic(); wait_s = follow_s; followup = True
            self.preroll.clear()


if __name__ == "__main__":
    try: asyncio.run(Ear().run())
    except KeyboardInterrupt: sys.exit(0)
