import type { Abi, Address, Hex, PublicClient } from "viem"
import { continuousClearingAuctionAbi, disputeResolverAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { fromKey } from "@fairtown/shared/keys"
import type { CheckpointView } from "./lib"

/** One contract call the keeper wants to make. `once` actions are never sent again after they succeed. */
export type Action = {
  key: string
  label: string
  once: boolean
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }
  /** Re-reads the contract right before sending. false = no longer needed (done by someone else, or moot). */
  stillNeeded: () => Promise<boolean>
}

export type SaleView = {
  settled: boolean
  released: boolean
  complete: boolean
  sector: string
  carrier: Address
  parentLotId: bigint
  soldTokens: bigint
  pickupDeadline: bigint
}
export type ReportView = { open: boolean; contested: boolean; contestEnds: bigint; tokens: bigint }
export type DisputeView = { open: boolean; lotId: bigint; openedBlock: bigint }
export type BidView = {
  owner: Address
  maxPrice: bigint
  exitedBlock: bigint
  tokensFilled: bigint
  startBlock: bigint
}

/** The reads the planners need, so planners can be tested with a fake chain. */
export interface Reads {
  sale(lotId: bigint): Promise<SaleView>
  report(lotId: bigint, buyer: Address): Promise<ReportView>
  dispute(disputeId: bigint): Promise<DisputeView>
  bid(auction: Address, id: bigint): Promise<BidView>
  lastCheckpointed(auction: Address): Promise<bigint>
  clearingPrice(auction: Address): Promise<bigint>
  checkpoint(auction: Address, block: bigint): Promise<CheckpointView>
}

export const ZERO = "0x0000000000000000000000000000000000000000" as Address

export function viemReads(pub: PublicClient, settlement: Address, resolver: Address = ZERO): Reads {
  const ms = { address: settlement, abi: marketSettlementAbi } as const
  const dr = { address: resolver, abi: disputeResolverAbi } as const
  const cca = (address: Address) => ({ address, abi: continuousClearingAuctionAbi }) as const
  return {
    async sale(lotId) {
      const s = await pub.readContract({ ...ms, functionName: "saleOf", args: [lotId] })
      return {
        settled: s.settled,
        released: s.released,
        complete: s.complete,
        sector: fromKey(s.sector as Hex),
        carrier: s.carrier,
        parentLotId: s.parentLotId,
        soldTokens: s.soldTokens,
        pickupDeadline: BigInt(s.pickupDeadline),
      }
    },
    async report(lotId, buyer) {
      const [open, contested, contestEnds, tokens] = await pub.readContract({
        ...ms,
        functionName: "reportOf",
        args: [lotId, buyer],
      })
      return { open, contested, contestEnds: BigInt(contestEnds), tokens }
    },
    async dispute(disputeId) {
      const d = await pub.readContract({ ...dr, functionName: "disputeOf", args: [disputeId] })
      return { open: d.open, lotId: d.lotId, openedBlock: BigInt(d.openedBlock) }
    },
    async bid(auction, id) {
      const b = await pub.readContract({ ...cca(auction), functionName: "bids", args: [id] })
      return {
        owner: b.owner,
        maxPrice: b.maxPrice,
        exitedBlock: BigInt(b.exitedBlock),
        tokensFilled: b.tokensFilled,
        startBlock: BigInt(b.startBlock),
      }
    },
    async lastCheckpointed(auction) {
      return BigInt(await pub.readContract({ ...cca(auction), functionName: "lastCheckpointedBlock" }))
    },
    async clearingPrice(auction) {
      return pub.readContract({ ...cca(auction), functionName: "clearingPrice" })
    },
    async checkpoint(auction, block) {
      const cp = await pub.readContract({ ...cca(auction), functionName: "checkpoints", args: [block] })
      return { block, clearingPrice: cp.clearingPrice, prev: BigInt(cp.prev) }
    },
  }
}

/** Everything a planner needs for one tick. */
export type PlanCtx = {
  head: bigint
  reads: Reads
  settlement: Address
  checkpointEvery: bigint
  reportWindowBlocks: bigint
  /** DisputeResolver and its ruling timeout (S1 4.1, D-65). Undefined on a v1 deployment: no dispute actions. */
  resolver?: Address
  rulingTimeoutBlocks?: bigint
}
