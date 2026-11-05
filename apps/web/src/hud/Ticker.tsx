import { useTown } from "../state/townStore"

/** Plain-words feed of what just happened, newest first. */
export function Ticker() {
  const lines = useTown((s) => s.ticker)
  return (
    <ul
      className="flex gap-6 overflow-hidden rounded bg-slate-900/85 px-3 py-1.5 text-sm whitespace-nowrap"
      aria-label="Ticker"
    >
      {lines.slice(0, 6).map((l) => (
        <li key={l.id}>{l.text}</li>
      ))}
    </ul>
  )
}
