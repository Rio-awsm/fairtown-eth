import { BaseError, getAbiItem, type Address, type Log, type PublicClient } from "viem"
import {
  continuousClearingAuctionAbi,
  disputeResolverAbi,
  lotFactoryAbi,
  marketSettlementAbi,
} from "@fairtown/shared/abi"
import { fromKey } from "@fairtown/shared/keys"
import type { Deployment } from "@fairtown/shared/addresses"
import { ZERO } from "./chain"
import { MIN_LOG_CHUNK } from "./config"
import { shrinkLogChunk } from "./lib"
import type { Logger } from "./log"
import type { KeeperState } from "./state"

const UNIT = 10n ** 18n
const REPORT_EVENTS = (["NoShowReported", "NoShowContested", "NoShowRefunded"] as const).map((name) =>
  getAbiItem({ abi: marketSettlementAbi, name }),
)

export type BootstrapResult = { lots: number; reportScans: number }

/**
 * Cold start from contract views (D-59, amends D-55): cost grows with the number of lots, not with chain age.
 * At ~5 blocks/s and a 200-block getLogs cap, replaying events from deployedAtBlock is thousands of calls a day.
 * - every lot: LotFactory.getLot, MarketSettlement.saleOf, CCA nextBidId (bid ids; owners come from bids() later)
 * - open no-show reports exist only in events: scanned only for lots with reportedTokens > 0, and only inside that
 *   lot's report window (pickupDeadline, pickupDeadline + reportWindow], the only blocks where reports can happen
 * The caller sets the cursor to the head read before this ran; live log sync from there overlaps the view reads
 * by a few blocks, and every ingest is idempotent.
 */
export async function bootstrapFromViews(
  state: KeeperState,
  pub: PublicClient,
  dep: Deployment,
  head: bigint,
  reportWindowBlocks: bigint,
  log: Logger,
  startChunk: bigint,
): Promise<BootstrapResult> {
  const factory = { address: dep.contracts.LotFactory as Address, abi: lotFactoryAbi } as const
  const ms = { address: dep.contracts.MarketSettlement as Address, abi: marketSettlementAbi } as const
  const count = await pub.readContract({ ...factory, functionName: "lotCount" })
  let chunk = startChunk
  let reportScans = 0
  for (let lotId = 1n; lotId <= count; lotId++) {
    const [lot, s] = await Promise.all([
      pub.readContract({ ...factory, functionName: "getLot", args: [lotId] }),
      pub.readContract({ ...ms, functionName: "saleOf", args: [lotId] }),
    ])
    const auction = lot.auction.toLowerCase() as Address
    state.lots.set(lotId, {
      lotId,
      auction,
      token: lot.token.toLowerCase() as Address,
      seller: lot.spec.seller.toLowerCase() as Address,
      sector: fromKey(lot.spec.sector),
      parentLotId: lot.spec.parentLotId,
      startBlock: BigInt(lot.startBlock),
      endBlock: BigInt(lot.endBlock),
    })
    state.byAuction.set(auction, lotId)
    const nBids = await pub.readContract({
      address: auction,
      abi: continuousClearingAuctionAbi,
      functionName: "nextBidId",
    })
    const bids = state.bids.get(lotId) ?? new Map<bigint, Address>()
    for (let id = 0n; id < nBids; id++) if (!bids.has(id)) bids.set(id, ZERO) // owner read from bids() when needed
    state.bids.set(lotId, bids)
    if (s.settled) {
      state.settled.set(lotId, {
        soldUnits: (s.soldTokens + UNIT - 1n) / UNIT, // same rounding as LotSettled.soldUnits (D-42)
        held: s.heldRemaining,
        pickupDeadline: BigInt(s.pickupDeadline),
      })
    }
    if (s.carrier !== ZERO) state.carriers.add(lotId)
    if (s.settled && s.reportedTokens > 0n) {
      const from = BigInt(s.pickupDeadline) + 1n
      const end = BigInt(s.pickupDeadline) + reportWindowBlocks
      chunk = await scanReports(state, pub, ms.address, lotId, from, end < head ? end : head, chunk, log)
      reportScans++
    }
  }
  log.info({ lots: Number(count), reportScans, head: head.toString() }, "state rebuilt from contract views")
  return { lots: Number(count), reportScans }
}

async function scanReports(
  state: KeeperState,
  pub: PublicClient,
  settlement: Address,
  lotId: bigint,
  from: bigint,
  to: bigint,
  chunk: bigint,
  log: Logger,
): Promise<bigint> {
  while (from <= to) {
    const end = from + chunk - 1n < to ? from + chunk - 1n : to
    try {
      const logs = (await pub.getLogs({
        address: settlement,
        events: REPORT_EVENTS,
        args: { lotId },
        fromBlock: from,
        toBlock: end,
      } as never)) as Log[]
      state.ingestCore(logs)
      from = end + 1n
    } catch (e) {
      const next = shrinkLogChunk(
        e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : String(e),
        chunk,
        MIN_LOG_CHUNK,
      )
      if (next === undefined) throw e
      chunk = next
      log.warn({ chunk: chunk.toString() }, "getLogs range too large, shrinking")
    }
  }
  return chunk
}

/**
 * Open disputes from DisputeResolver views (S1 4.1): `disputeCount`, then `disputeOf(id)` for each. Cost per dispute,
 * not per block. Resolved and expired disputes are skipped.
 */
export async function bootstrapDisputes(
  state: KeeperState,
  pub: PublicClient,
  resolver: Address,
  log: Logger,
): Promise<number> {
  const dr = { address: resolver, abi: disputeResolverAbi } as const
  const count = await pub.readContract({ ...dr, functionName: "disputeCount" })
  for (let id = 1n; id <= count; id++) {
    const d = await pub.readContract({ ...dr, functionName: "disputeOf", args: [id] })
    if (d.open) state.disputes.set(id, { disputeId: id, lotId: d.lotId, openedBlock: BigInt(d.openedBlock) })
  }
  log.info({ disputes: Number(count), open: state.disputes.size }, "disputes rebuilt from resolver views")
  return state.disputes.size
}
