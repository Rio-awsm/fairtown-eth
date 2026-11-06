import { useTown, type TownMode } from "../state/townStore"

export function ModeBadge({ mode }: { mode?: TownMode }) {
  const storeMode = useTown((s) => s.mode)
  const live = (mode ?? storeMode) === "live"
  return (
    <span className={`rpg-badge gap-1.5 ${live ? "bg-brick text-parchment-light" : "bg-coin text-ink"}`}>
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 ${live ? "animate-pulse bg-parchment-light" : "bg-ink"}`}
      />
      {live ? "LIVE" : "REPLAY"}
    </span>
  )
}

export function TestMoneyBadge() {
  return <span className="rpg-badge bg-moss text-parchment-light">TEST MONEY</span>
}
