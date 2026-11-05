import { useTown } from "../state/townStore"
import { worldClock } from "./model"

/** Bergen, Dallas, Mumbai and the data centre: local time and the next lot to expire there. */
export function WorldClock() {
  const town = useTown((s) => s.town)
  const ts = useTown((s) => s.ts)
  const rows = worldClock(town, ts ?? Date.now())
  return (
    <ul className="grid grid-cols-4 gap-2 rounded bg-slate-900/85 p-2 text-sm" aria-label="World clock">
      {rows.map((r) => (
        <li key={r.id} className="min-w-28">
          <span className="block text-xs text-slate-400">{r.city}</span>
          <span className="block font-mono text-lg">{r.time}</span>
          <span className="block text-xs text-amber-300">
            {r.nextExpiry ? `Lot ${r.nextExpiry.lotId} ends in ${r.nextExpiry.label}` : "nothing open"}
          </span>
        </li>
      ))}
    </ul>
  )
}
