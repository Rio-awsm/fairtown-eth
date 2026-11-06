import { marketSettlementAbi } from "@fairtown/shared/abi"
import { ZERO, type Action, type PlanCtx } from "./chain"
import type { KeeperState } from "./state"

/** Sectors that move and so take a carrier (contract 7.6; `Keys.needsTransport` onchain). */
export const GOODS_SECTORS: ReadonlySet<string> = new Set(["produce", "fish", "flowers"])

/**
 * The goods lot a truck lot serves, or 0n for a standalone truck lot, or undefined if the chain is unknown.
 * A relisted truck lot names the old truck lot as its parent (relist history), so truck parents are followed to
 * the goods lot, the same way MarketSettlement resolves `Sale.parentLotId` at settle (D-61).
 */
export function goodsParentOf(state: KeeperState, truckId: bigint): bigint | undefined {
  let id = state.lots.get(truckId)?.parentLotId
  for (let hops = 0; id !== undefined && id !== 0n && hops < 64; hops++) {
    const p = state.lots.get(id)
    if (!p) return undefined
    if (p.sector !== "truck") return id
    id = p.parentLotId
  }
  return id === 0n ? 0n : undefined
}

/**
 * When a sold truck lot serving a goods lot settles, assign its seller as the goods lot's carrier. Works whichever
 * lot settles last. Relisted truck lots serve the goods lot of their chain (D-61). One action per goods lot: the
 * first sold truck lot wins, and the contract rejects a second carrier anyway.
 */
export function planCarriers(state: KeeperState, ctx: PlanCtx): Action[] {
  const out: Action[] = []
  const planned = new Set<bigint>()
  for (const [truckId, t] of state.settled) {
    const truck = state.lots.get(truckId)
    if (!truck || truck.sector !== "truck" || t.soldUnits === 0n) continue
    const parentId = goodsParentOf(state, truckId)
    if (!parentId) continue // standalone (Dallas) or unknown chain
    const parent = state.lots.get(parentId)
    if (!parent || !GOODS_SECTORS.has(parent.sector)) continue
    if (!state.settled.has(parentId) || state.carriers.has(parentId) || planned.has(parentId)) continue
    planned.add(parentId)
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
          GOODS_SECTORS.has(p.sector) &&
          tr.settled &&
          tr.soldTokens > 0n &&
          tr.parentLotId === parentId // resolved onchain at settle (D-61)
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
