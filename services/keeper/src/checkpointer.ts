import { continuousClearingAuctionAbi } from "@fairtown/shared/abi"
import type { Action, PlanCtx } from "./chain"
import type { KeeperState } from "./state"

/**
 * D-54 (amends D-15): while an auction is live and has at least one bid, checkpoint it when `checkpointEvery`
 * blocks passed since its last checkpoint. Bids checkpoint on their own, so a busy auction needs no keeper tx.
 * The end block is never checkpointed here: settle's sweep does that (ensureEndBlockIsCheckpointed).
 */
export async function planCheckpoints(state: KeeperState, ctx: PlanCtx): Promise<Action[]> {
  const out: Action[] = []
  for (const lot of state.lots.values()) {
    if (ctx.head < lot.startBlock || ctx.head >= lot.endBlock) continue
    if ((state.bids.get(lot.lotId)?.size ?? 0) === 0) continue
    const last = await ctx.reads.lastCheckpointed(lot.auction)
    if (ctx.head - last < ctx.checkpointEvery) continue
    out.push({
      key: `checkpoint:${lot.auction}`,
      label: `checkpoint lot ${lot.lotId}`,
      once: false,
      call: { address: lot.auction, abi: continuousClearingAuctionAbi, functionName: "checkpoint", args: [] },
      stillNeeded: async () => ctx.head - (await ctx.reads.lastCheckpointed(lot.auction)) >= ctx.checkpointEvery,
    })
  }
  return out
}
