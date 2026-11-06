import type { LotStatus } from "@fairtown/shared/keys"
import type { Selection } from "../game/EventBus"
import type { LotState } from "../game/reducer"

/** A lot's whole life on one strip (D-122): listed, auctioned, sold, carried, delivered, paid. */
export const JOURNEY = ["Listed", "Auction", "Sold", "Truck", "Picked up", "Delivered", "Paid"] as const
export type JourneyName = (typeof JOURNEY)[number]
export type JourneyState = "done" | "current" | "pending" | "alert"
export type JourneyStep = { name: JourneyName; state: JourneyState; note?: string }

/** Statuses where the lot's story has ended: nothing more will happen to it. */
const FINISHED: ReadonlySet<LotStatus> = new Set(["paid_in_full", "relisted", "refunded"])

const ALERT: Partial<Record<LotStatus, string>> = {
  no_show_reported: "No-show reported",
  disputed: "Disputed",
  refunded: "Refunded",
}

/**
 * The strip's steps for a lot. Listed is always done. Auction runs while the lot is open, and is
 * flagged if it ended unsold (relisted). The last five follow the lot's furthest step (`progress`,
 * 0 to 5, as in the lot panel's timeline): a step is done when passed, current when the lot waits
 * on it, and flagged when a no-show, dispute or refund stopped it there.
 */
export function journeySteps(lot: Pick<LotState, "status" | "progress">): JourneyStep[] {
  const progress = Math.max(0, Math.min(5, lot.progress))
  const alert = ALERT[lot.status]
  const auction: JourneyStep =
    lot.status === "open"
      ? { name: "Auction", state: "current" }
      : lot.status === "relisted"
        ? { name: "Auction", state: "alert", note: "Unsold, relisted" }
        : progress > 0
          ? { name: "Auction", state: "done" }
          : { name: "Auction", state: "pending" }
  const after = JOURNEY.slice(2).map((name, i): JourneyStep => {
    if (i < progress) return { name, state: "done" }
    if (i !== progress || progress === 0) return { name, state: "pending" }
    if (alert) return { name, state: "alert", note: alert }
    return { name, state: FINISHED.has(lot.status) ? "pending" : "current" }
  })
  return [{ name: "Listed", state: "done" }, auction, ...after]
}

/**
 * Which lot the strip follows: the selected lot; otherwise the newest auction still open;
 * otherwise the newest lot whose story is still going; otherwise the newest lot. Lots keep the
 * order they were listed in.
 */
export function spotlightLot(lots: Record<string, LotState>, selection: Selection): string | undefined {
  if (selection?.kind === "lot" && lots[selection.id]) return selection.id
  const all = Object.values(lots)
  const newest = (pred: (l: LotState) => boolean) => all.filter(pred).at(-1)?.lotId
  return newest((l) => l.status === "open") ?? newest((l) => !FINISHED.has(l.status)) ?? all.at(-1)?.lotId
}
