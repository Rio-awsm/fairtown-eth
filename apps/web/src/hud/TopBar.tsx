import { useTown } from "../state/townStore"
import { ModeBadge, TestMoneyBadge } from "./ModeBadge"

/** Block, active signals, relay status, LIVE or REPLAY and TEST MONEY. */
export function TopBar() {
  const block = useTown((s) => s.town.block)
  const signals = useTown((s) => s.town.signals)
  const status = useTown((s) => s.status)
  const active = Object.values(signals).filter((sig) => sig.expiresAtBlock > block)
  return (
    <div className="flex items-center gap-3 rounded bg-slate-900/85 px-3 py-1.5 text-sm">
      <ModeBadge />
      <TestMoneyBadge />
      <span title="Latest block seen on the relay">Block {block}</span>
      <span className="text-slate-400" title="Relay connection">
        {status}
      </span>
      <ul className="flex gap-2">
        {active.map((sig) => (
          <li
            key={sig.id}
            className="rounded bg-indigo-900 px-2 py-0.5 text-xs"
            title={`signal ${sig.kind} at ${sig.place}`}
          >
            {sig.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
