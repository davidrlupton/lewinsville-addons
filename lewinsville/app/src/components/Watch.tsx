"use client";
import { useEffect, useState } from "react";
import type { Review } from "@/lib/watch";
import { Segmented } from "./Segmented";

const TONE: Record<string, [string, string]> = {
  family: ["Family", "var(--leaf)"], expected: ["Expected", "var(--peacock)"], unexpected: ["Unexpected", "var(--saffron)"],
  unsure: ["Not sure", "var(--marigold)"], error: ["Could not look", "var(--ink-soft)"],
};
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const cam = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/** What the cameras saw and what the house made of it. Owners only. Quiet: nothing here rings or texts anyone. */
export function Watch() {
  const [all, setAll] = useState<Review[] | null>(null);
  const [show, setShow] = useState<"look" | "all">("look");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { fetch("/api/watch?days=2").then((r) => r.json()).then((j) => setAll(j.reviews ?? [])).catch(() => setAll([])); }, []);
  const grade = async (r: Review, value: "fine" | "not_fine") => {
    setAll((rs) => rs?.map((x) => (x.id === r.id ? { ...x, grade: value } : x)) ?? null);
    await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, grade: value }) });
  };
  if (!all) return null;
  const look = all.filter((r) => (r.verdict === "unexpected" || r.verdict === "unsure") && !r.grade);
  const list = (show === "look" ? look : all).slice(0, 40);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-extrabold">Cameras</h2>
        <Segmented value={show} options={[["look", `To check${look.length ? ` · ${look.length}` : ""}`], ["all", "Everything"]] as const} onChange={setShow} label="Which reviews" />
      </div>
      {list.length === 0 && <div className="card p-4 text-sm opacity-70">{show === "look" ? "Nothing to check." : "The cameras have seen nothing yet."}</div>}
      <div className="space-y-2">
        {list.map((r) => {
          const [label, color] = TONE[r.verdict] ?? TONE.error;
          return (
            <div key={r.id} className="card enter flex gap-3 p-3 text-sm">
              <button className="shrink-0" onClick={() => setOpen(open === r.id ? null : r.id)} aria-label="Show the whole picture">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/watch?img=${r.id}${open === r.id ? "&scene=1" : ""}`} alt="" className={`rounded-xl object-cover ${open === r.id ? "h-40 w-64" : "h-20 w-20"}`} style={{ background: "var(--line)" }} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="num flex items-center justify-between gap-2 text-xs text-ink-soft"><span>{cam(r.camera)} · {fmt(r.at)}{r.protectedHours ? " · night" : ""}</span><span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: color }}>{label}</span></div>
                {r.who && <div className="mt-1 font-bold">{r.who}</div>}
                {r.why && <div className="opacity-80">{r.why}</div>}
                <div className="mt-2 flex gap-2">
                  {(["fine", "not_fine"] as const).map((v) => (
                    <button key={v} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: r.grade === v ? "var(--ink)" : "color-mix(in srgb, var(--ink) 10%, transparent)", color: r.grade === v ? "var(--cream)" : undefined }} onClick={() => grade(r, v)}>{v === "fine" ? "That's fine" : "Not fine"}</button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
