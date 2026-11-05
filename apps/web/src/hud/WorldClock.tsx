import { useTown } from "../state/townStore"
import { worldClock } from "./model"

/** Bergen, Dallas, Mumbai and the data centre: local time and the next lot to expire there. */
export function WorldClock() {
  const town = useTown((s) => s.town)
  const ts = useTown((s) => s.ts)
  const rows = worldClock(town, ts ?? Date.now())
  const focus = useTown((s) => s.ui.clockFocus)
  return (
    <ul
      aria-label="World clock"
      className={
        focus
          ? "fixed top-16 left-1/2 z-10 grid -translate-x-1/2 grid-cols-4 gap-6 rounded bg-slate-900/95 p-6 text-xl"
          : "grid grid-cols-4 gap-2 rounded bg-slate-900/85 p-2 text-sm"
      }
    >
      {rows.map((r) => (
        <li key={r.id} className="min-w-28">
          <span className="block text-xs text-slate-400">{r.city}</span>
          <span className={`block font-mono ${focus ? "text-6xl" : "text-lg"}`}>{r.time}</span>
          <span className="block text-xs text-amber-300">
            {r.nextExpiry ? `Lot ${r.nextExpiry.lotId} ends in ${r.nextExpiry.label}` : "nothing open"}
          </span>
        </li>
      ))}
    </ul>
  )
}
