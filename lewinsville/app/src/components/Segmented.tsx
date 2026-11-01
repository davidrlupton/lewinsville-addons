"use client";
// One segmented control for the whole app: a pill slides under the chosen segment (a transition, so a quick
// second tap retargets mid-flight) and the labels change colour over it. Used by the tab bar's cousins:
// Energy's range and unit, the circuit sort, the log window.
export function Segmented<T extends string>({ value, options, onChange, size = "sm", label }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; size?: "sm" | "md"; label?: string;
}) {
  const i = Math.max(0, options.findIndex(([k]) => k === value));
  const n = options.length;
  return (
    <div role="group" aria-label={label} className="relative flex rounded-full p-0.5" style={{ background: "var(--cream)", border: "1px solid var(--line)" }}>
      <div aria-hidden className="pill pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-full" style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${i * 100}%)`, background: "var(--ink)" }} />
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`relative z-10 flex-1 rounded-full font-bold ${size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"}`}
          style={{ color: value === k ? "var(--cream)" : "var(--ink)" }}>{l}</button>
      ))}
    </div>
  );
}
