"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { House } from "@/lib/house";

export type Me = { email: string; name: string; role: string; theme: "festival" | "slate"; greeting: string; chat: boolean };

export function useHouse() {
  const [house, setHouse] = useState<House | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/me").then(async (r) => (r.ok ? setMe(await r.json()) : setError("Not signed in"))).catch(() => setError("Offline"));
    const open = () => {
      es.current?.close();
      const s = new EventSource("/api/state");
      s.onmessage = (ev) => { setHouse(JSON.parse(ev.data)); setError(null); };
      s.onerror = () => { setError("Reconnecting…"); };
      es.current = s;
    };
    open();
    const vis = () => { if (document.visibilityState === "visible") open(); };
    document.addEventListener("visibilitychange", vis);
    return () => { es.current?.close(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setError((await r.json().catch(() => ({ error: "failed" }))).error);
    return r.ok;
  }, []);

  return { house, me, error, call };
}
