import { marketSettlementAbi } from "@fairtown/shared/abi"
import type { Action, PlanCtx } from "./chain"
import type { KeeperState } from "./state"

/** Settle every lot at its end block (contract: `block.number >= endBlock`), zero-bid lots included. */
export function planSettles(state: KeeperState, ctx: PlanCtx): Action[] {
  const out: Action[] = []
  for (const lot of state.lots.values()) {
    if (state.settled.has(lot.lotId) || ctx.head < lot.endBlock) continue
    out.push({
      key: `settle:${lot.lotId}`,
      label: `settle lot ${lot.lotId}`,
      once: true,
      call: { address: ctx.settlement, abi: marketSettlementAbi, functionName: "settle", args: [lot.lotId] },
      stillNeeded: async () => !(await ctx.reads.sale(lot.lotId)).settled,
    })
  }
  return out
}
