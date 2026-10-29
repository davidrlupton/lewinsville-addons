"use client";
// Recorded sounds: record on the phone, keep on the hub, play on a speaker. Dead simple on purpose.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "./useHouse";

type Sound = { id: string; name: string; who: string; created: number; seconds: number | null };
type Speaker = { key: string; label: string };

export function Sounds({ me }: { me: Me | null }) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rec, setRec] = useState<{ since: number } | null>(null);
  const [pending, setPending] = useState<{ blob: Blob; name: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [secs, setSecs] = useState(0);

  const load = useCallback(async () => {
    const r = await fetch("/api/sounds"); if (!r.ok) return;
    const j = await r.json(); setSounds(j.sounds); setSpeakers(j.speakers);
  }, []);
  useEffect(() => {
    let on = true;
    fetch("/api/sounds").then((r) => (r.ok ? r.json() : null)).then((j) => { if (on && j) { setSounds(j.sounds); setSpeakers(j.speakers); } }).catch(() => {});
    return () => { on = false; };
  }, []);

  const canAdd = me != null && me.role !== "guest";
  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = []; const startedAt = Date.now();
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); setSecs(Math.floor((Date.now() - startedAt) / 1000)); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setPending({ blob: new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }), name: "" });
        setRec(null);
      };
      recorder.current = mr; mr.start(500); setSecs(0); setRec({ since: startedAt }); setNote(null);
    } catch { setNote("The phone would not share its microphone. Allow it for lewinsville.vip in Settings and try again."); }
  }
  function stopRecording() { recorder.current?.stop(); }

  async function upload(blob: Blob, name: string, fileName = "recording") {
    setBusy("save");
    const fd = new FormData(); fd.append("name", name); fd.append("file", blob, fileName);
    const r = await fetch("/api/sounds", { method: "POST", body: fd });
    setBusy(null);
    if (!r.ok) { setNote((await r.json().catch(() => ({ error: "Could not save" }))).error); return; }
    setPending(null); setNote(null); await load();
  }
  async function play(id: string, where: string) {
    setBusy(`${id}:${where}`);
    const r = await fetch("/api/sounds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ play: id, where }) });
    setBusy(null);
    if (!r.ok) setNote((await r.json().catch(() => ({ error: "Could not play" }))).error);
  }
  async function remove(id: string) {
    if (!confirm("Delete this sound?")) return;
    await fetch(`/api/sounds?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await load();
  }

  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-extrabold">Sounds</h2>
        <span className="text-xs font-bold opacity-60">{sounds.length ? `${sounds.length} saved` : "say something to the house"}</span>
      </div>

      {canAdd && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {canRecord && (rec
            ? <button className="rounded-full px-4 py-2 font-extrabold text-white" style={{ background: "var(--saffron)" }} onClick={stopRecording}>■ Stop · {secs}s</button>
            : <button className="rounded-full px-4 py-2 font-extrabold text-cream" style={{ background: "var(--ink)" }} onClick={startRecording} disabled={!!pending}>● Record</button>)}
          <label className="cursor-pointer rounded-full px-4 py-2 font-bold" style={{ background: "var(--cream)" }}>
            Upload a file
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, f.name.replace(/\.[^.]+$/, ""), f.name); e.target.value = ""; }} />
          </label>
        </div>
      )}

      {pending && (
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void upload(pending.blob, pending.name); }}>
          <input autoFocus className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--cream)" }} placeholder="Name it, e.g. Good morning kids" value={pending.name} onChange={(e) => setPending({ ...pending, name: e.target.value })} />
          <button className="rounded-xl px-3 py-2 text-sm font-extrabold text-cream" style={{ background: "var(--ink)" }} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
          <button type="button" className="rounded-xl px-3 py-2 text-sm font-bold" style={{ background: "var(--cream)" }} onClick={() => setPending(null)}>Discard</button>
        </form>
      )}

      {note && <div className="mb-3 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "var(--saffron)", color: "white" }}>{note}</div>}

      {sounds.length === 0 ? (
        <div className="text-sm opacity-70">{canAdd ? "Record a good morning for the kids and play it from anywhere." : "Nothing recorded yet."}</div>
      ) : (
        <ul className="space-y-2">
          {sounds.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--cream)" }}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{s.name}</div>
                <div className="text-[11px] opacity-60">{s.who}{s.seconds != null ? ` · ${s.seconds}s` : ""}</div>
              </div>
              {speakers.map((sp) => (
                <button key={sp.key} className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ background: "var(--peacock)", opacity: busy === `${s.id}:${sp.key}` ? .5 : 1 }} onClick={() => play(s.id, sp.key)} disabled={!!busy}>▶ {sp.label}</button>
              ))}
              {me?.role === "owner" && <button className="px-1 text-base opacity-40" aria-label="Delete" onClick={() => remove(s.id)}>×</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
