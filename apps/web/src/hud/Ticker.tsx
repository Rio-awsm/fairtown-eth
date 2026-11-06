import { useTown } from "../state/townStore"

/** Plain-words feed of what just happened, newest first. */
export function Ticker() {
  const lines = useTown((s) => s.ticker)
  return (
    <ul className="rpg-window flex gap-6 overflow-hidden px-4 py-2 text-sm whitespace-nowrap" aria-label="Ticker">
      {lines.slice(0, 3).map((l, i) => (
        <li key={l.id} className={i === 0 ? "font-bold" : "text-ink-soft"}>
          <span
            aria-hidden="true"
            className="mr-2 inline-block h-2 w-2 bg-coin align-middle shadow-[0_0_0_1px_#2a1f33]"
          />
          {l.text}
        </li>
      ))}
    </ul>
  )
}
