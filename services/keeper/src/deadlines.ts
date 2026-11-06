import { marketSettlementAbi } from "@fairtown/shared/abi"
import { ZERO, type Action, type PlanCtx } from "./chain"
import type { KeeperState } from "./state"

/**
 * When a sold truck lot with a parent settles, assign its seller as the parent's carrier. Works whichever lot
 * settles last. A relisted truck lot points at the old truck lot as its parent (contracts/NOTES.md, S1 1.3), and
 * MarketSettlement does not check the parent's sector, so the keeper never assigns a truck lot as a carrier's parent.
 */
export function planCarriers(state: KeeperState, ctx: PlanCtx): Action[] {
  const out: Action[] = []
  for (const [truckId, t] of state.settled) {
    const truck = state.lots.get(truckId)
    if (!truck || truck.sector !== "truck" || truck.parentLotId === 0n || t.soldUnits === 0n) continue
    const parentId = truck.parentLotId
    const parent = state.lots.get(parentId)
    if (!parent || parent.sector === "truck") continue
    if (!state.settled.has(parentId) || state.carriers.has(parentId)) continue
    out.push({
      key: `carrier:${parentId}`,
      label: `assignCarrier lot ${parentId} truck lot ${truckId}`,
      once: true,
      call: {
        address: ctx.settlement,
        abi: marketSettlementAbi,
        functionName: "assignCarrier",
        args: [parentId, truckId],
      },
      stillNeeded: async () => {
        const [p, tr] = await Promise.all([ctx.reads.sale(parentId), ctx.reads.sale(truckId)])
        return (
          p.settled &&
          p.soldTokens > 0n &&
          !p.complete &&
          !p.released &&
          p.carrier === ZERO &&
          p.sector !== "truck" &&
          tr.settled &&
          tr.soldTokens > 0n
        )
      },
    })
  }
  return out
}

/** Uncontested no-show reports, after the contest window (contract: `block.number > contestEnds`). */
export function planNoShows(state: KeeperState, ctx: PlanCtx): Action[] {
  const out: Action[] = []
  for (const r of state.reports.values()) {
    if (r.contested || ctx.head <= r.contestEnds) continue
    out.push({
      key: `finalize:${r.lotId}:${r.buyer}`,
      label: `finalizeNoShow lot ${r.lotId} buyer ${r.buyer}`,
      once: true,
      call: {
        address: ctx.settlement,
        abi: marketSettlementAbi,
        functionName: "finalizeNoShow",
        args: [r.lotId, r.buyer],
      },
      stillNeeded: async () => {
        const v = await ctx.reads.report(r.lotId, r.buyer)
        return v.open && !v.contested && ctx.head > v.contestEnds
      },
    })
  }
  return out
}

/** Silent buyers' held share goes to the seller after the report window (contract: `block.number > reportEnds`). */
export function planReleases(state: KeeperState, ctx: PlanCtx): Action[] {
  const out: Action[] = []
  for (const [lotId, s] of state.settled) {
    if (s.soldUnits === 0n || ctx.head <= s.pickupDeadline + ctx.reportWindowBlocks) continue
    out.push({
      key: `release:${lotId}`,
      label: `releaseExpired lot ${lotId}`,
      once: true,
      call: { address: ctx.settlement, abi: marketSettlementAbi, functionName: "releaseExpired", args: [lotId] },
      stillNeeded: async () => {
        const v = await ctx.reads.sale(lotId)
        return v.settled && v.soldTokens > 0n && !v.released && !v.complete
      },
    })
  }
  return out
}
