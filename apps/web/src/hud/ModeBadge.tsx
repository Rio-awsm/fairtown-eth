import { useTown, type TownMode } from "../state/townStore"

export function ModeBadge({ mode }: { mode?: TownMode }) {
  const storeMode = useTown((s) => s.mode)
  const live = (mode ?? storeMode) === "live"
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-bold tracking-wide ${live ? "bg-red-600 text-white" : "bg-amber-400 text-black"}`}
    >
      {live ? "LIVE" : "REPLAY"}
    </span>
  )
}

export function TestMoneyBadge() {
  return (
    <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold tracking-wide text-white">TEST MONEY</span>
  )
}
