import type { Address } from "viem"
import { continuousClearingAuctionAbi } from "@fairtown/shared/abi"
import type { Action, BidView, PlanCtx } from "./chain"
import { exitHints, type CheckpointView } from "./lib"
import type { KeeperState } from "./state"

export type ExitCall =
  | { functionName: "exitBid"; args: [bigint] }
  | { functionName: "exitPartiallyFilledBid"; args: [bigint, bigint, bigint] }

/**
 * Which exit a bid needs once the end block is checkpointed (CCA v2.1.0, ContinuousClearingAuction.sol 495-602):
 * - maxPrice > final clearing: `exitBid`, fully filled while live, no hints.
 * - maxPrice <= final clearing: `exitPartiallyFilledBid(id, lastFullyFilled, outbid)`. lastFullyFilled is the latest
 *   checkpoint with clearing < maxPrice; outbid is the earliest with clearing > maxPrice, or 0 when the final
 *   clearing equals maxPrice. Both come from walking `prev` back from `lastCheckpointedBlock` (lib.exitHints).
 */
export async function exitCall(
  id: bigint,
  bid: Pick<BidView, "maxPrice">,
  finalClearing: bigint,
  lastCheckpointed: bigint,
  get: (block: bigint) => Promise<CheckpointView>,
): Promise<ExitCall> {
  if (bid.maxPrice > finalClearing) return { functionName: "exitBid", args: [id] }
  const h = await exitHints(bid.maxPrice, lastCheckpointed, get)
  return { functionName: "exitPartiallyFilledBid", args: [id, h.lastFullyFilled, h.outbid] }
}

/** claimTokensBatch per owner, only for exited bids that still hold tokens. */
export function claimGroups(bids: { id: bigint; view: BidView }[]): Map<Address, bigint[]> {
  const out = new Map<Address, bigint[]>()
  for (const { id, view } of bids) {
    if (view.exitedBlock === 0n || view.tokensFilled === 0n) continue
    const owner = view.owner.toLowerCase() as Address
    out.set(owner, [...(out.get(owner) ?? []), id])
  }
  return out
}

/**
 * After settle (which checkpoints the end block): exit every bid, then claim tokens for every owner, so buyers hold
 * lot tokens before their handover ticket. Claims are planned on the tick after all exits are seen onchain.
 */
export async function planExits(state: KeeperState, ctx: PlanCtx): Promise<Action[]> {
  const out: Action[] = []
  for (const lotId of state.settled.keys()) {
    if (state.exitsDone.has(lotId)) continue
    const lot = state.lots.get(lotId)
    const ids = [...(state.bids.get(lotId)?.keys() ?? [])]
    if (!lot || ids.length === 0) {
      state.exitsDone.add(lotId)
      continue
    }
    const auction = lot.auction
    const last = await ctx.reads.lastCheckpointed(auction)
    if (last < lot.endBlock) continue // settle not visible yet
    const views = await Promise.all(ids.map(async (id) => ({ id, view: await ctx.reads.bid(auction, id) })))
    const open = views.filter((b) => b.view.exitedBlock === 0n)
    if (open.length > 0) {
      const final = await ctx.reads.clearingPrice(auction)
      const memo = new Map<bigint, Promise<CheckpointView>>()
      const get = (b: bigint) => {
        if (!memo.has(b)) memo.set(b, ctx.reads.checkpoint(auction, b))
        return memo.get(b)!
      }
      for (const { id, view } of open) {
        const c = await exitCall(id, view, final, last, get)
        out.push({
          key: `exit:${auction}:${id}`,
          label: `${c.functionName} lot ${lotId} bid ${id}`,
          once: true,
          call: { address: auction, abi: continuousClearingAuctionAbi, ...c },
          stillNeeded: async () => (await ctx.reads.bid(auction, id)).exitedBlock === 0n,
        })
      }
      continue
    }
    const groups = claimGroups(views)
    if (groups.size === 0) {
      state.exitsDone.add(lotId)
      continue
    }
    for (const [owner, bidIds] of groups) {
      out.push({
        key: `claim:${auction}:${owner}`,
        label: `claimTokensBatch lot ${lotId} owner ${owner} (${bidIds.length} bids)`,
        once: true,
        call: {
          address: auction,
          abi: continuousClearingAuctionAbi,
          functionName: "claimTokensBatch",
          args: [owner, bidIds],
        },
        stillNeeded: async () => {
          for (const id of bidIds) if ((await ctx.reads.bid(auction, id)).tokensFilled > 0n) return true
          return false
        },
      })
    }
  }
  return out
}
