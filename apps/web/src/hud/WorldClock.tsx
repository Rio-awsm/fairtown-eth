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
          ? "rpg-window fixed top-16 left-1/2 z-10 grid -translate-x-1/2 grid-cols-4 gap-6 p-6 text-xl"
          : "rpg-window grid grid-cols-4 gap-3 px-3 py-2 text-sm"
      }
    >
      {rows.map((r) => (
        <li key={r.id} className="min-w-28">
          <span className="block font-display text-xs font-semibold text-ink-soft">{r.city}</span>
          <span className={`block font-display font-bold tabular-nums ${focus ? "text-6xl" : "text-2xl"}`}>
            {r.time}
          </span>
          {/* Only a lot that is open says anything: an idle city stays quiet (D-122). */}
          {r.nextExpiry && (
            <span className="block text-xs text-gold-ink">
              Lot {r.nextExpiry.lotId} ends in {r.nextExpiry.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
