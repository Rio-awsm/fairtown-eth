import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { TxLink } from "./links"
import { timelineSteps, type ApiStep } from "./model"

const DOT = { done: "bg-moss", current: "bg-coin animate-pulse", pending: "bg-parchment-edge" } as const

/** Sold → Truck booked → Picked up → Delivered → Paid in full, with a red Refunded branch. */
export function Timeline({ lot, block, apiSteps }: { lot: LotState; block: number; apiSteps?: ApiStep[] }) {
  const { steps, refunded } = timelineSteps(lot, apiSteps)
  return (
    <div>
      <ol className="flex gap-1 text-xs" aria-label="Lot timeline">
        {steps.map((s) => (
          <li key={s.name} data-state={s.state} className="rpg-well flex-1 p-1.5">
            <span className={`mr-1 inline-block h-2 w-2 rounded-full ${DOT[s.state]}`} />
            {s.name}
            {s.alert && <span className="block text-brick">{s.alert}</span>}
            {s.deadlineBlock !== undefined && (
              <span className="block text-gold-ink" title={`deadline block ${s.deadlineBlock}`}>
                deadline in {countdown(s.deadlineBlock, block)}
              </span>
            )}
            {s.tx && (
              <span className="block">
                <TxLink tx={s.tx} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {refunded && (
        <p role="status" className="rpg-well mt-2 bg-brick-tint px-2 py-1 text-xs">
          {refunded.label}
        </p>
      )}
    </div>
  )
}
