import { parseEventLogs, type Address, type Hex, type Log } from "viem"
import { continuousClearingAuctionAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { fromKey } from "@fairtown/shared/keys"

export type LotInfo = {
  lotId: bigint
  auction: Address
  token: Address
  seller: Address
  sector: string
  parentLotId: bigint
  startBlock: bigint
  endBlock: bigint
}
export type SettledInfo = { soldUnits: bigint; held: bigint; pickupDeadline: bigint }
export type ReportInfo = { lotId: bigint; buyer: Address; contestEnds: bigint; contested: boolean }

const lower = (a: string) => a.toLowerCase() as Address
export const reportKey = (lotId: bigint, buyer: Address) => `${lotId}:${lower(buyer)}`

/** Events the keeper reads from LotFactory and MarketSettlement. */
export const CORE_ABI = [...lotFactoryAbi, ...marketSettlementAbi] as const
const CORE_EVENTS = [
  "LotListed",
  "LotSettled",
  "CarrierAssigned",
  "NoShowReported",
  "NoShowContested",
  "NoShowRefunded",
] as const

/**
 * What the keeper knows, rebuilt from logs on every start (D-55). It only says which actions might be due: every
 * action re-reads the contract view before it is sent, so a stale or partial state can never cause a wrong action.
 */
export class KeeperState {
  readonly lots = new Map<bigint, LotInfo>()
  readonly byAuction = new Map<Address, bigint>()
  /** lotId -> bid id -> owner */
  readonly bids = new Map<bigint, Map<bigint, Address>>()
  readonly settled = new Map<bigint, SettledInfo>()
  /** Goods lots that have a carrier. */
  readonly carriers = new Set<bigint>()
  /** Open no-show reports, keyed by reportKey. */
  readonly reports = new Map<string, ReportInfo>()
  /** Lots whose bids are all exited and claimed, verified onchain. Other one-shot work is tracked by the queue. */
  readonly exitsDone = new Set<bigint>()
  /** Last block whose logs are ingested. */
  cursor = 0n

  /** Auctions that may still receive bids in [from, to]. */
  auctionsLiveIn(from: bigint, to: bigint): Address[] {
    const out: Address[] = []
    for (const l of this.lots.values()) if (l.startBlock <= to && l.endBlock >= from) out.push(l.auction)
    return out
  }

  ingestCore(logs: Log[]) {
    for (const ev of parseEventLogs({ abi: CORE_ABI, logs, eventName: [...CORE_EVENTS] })) {
      switch (ev.eventName) {
        case "LotListed": {
          const a = ev.args
          const info: LotInfo = {
            lotId: a.lotId,
            auction: lower(a.auction),
            token: lower(a.token),
            seller: lower(a.seller),
            sector: fromKey(a.sector as Hex),
            parentLotId: a.parentLotId,
            startBlock: BigInt(a.startBlock),
            endBlock: BigInt(a.endBlock),
          }
          this.lots.set(info.lotId, info)
          this.byAuction.set(info.auction, info.lotId)
          if (!this.bids.has(info.lotId)) this.bids.set(info.lotId, new Map())
          break
        }
        case "LotSettled":
          this.settled.set(ev.args.lotId, {
            soldUnits: ev.args.soldUnits,
            held: ev.args.held,
            pickupDeadline: BigInt(ev.args.pickupDeadline),
          })
          break
        case "CarrierAssigned":
          this.carriers.add(ev.args.lotId)
          break
        case "NoShowReported":
          this.reports.set(reportKey(ev.args.lotId, ev.args.buyer), {
            lotId: ev.args.lotId,
            buyer: lower(ev.args.buyer),
            contestEnds: BigInt(ev.args.contestEnds),
            contested: false,
          })
          break
        case "NoShowContested": {
          const r = this.reports.get(reportKey(ev.args.lotId, ev.args.buyer))
          if (r) r.contested = true
          break
        }
        case "NoShowRefunded":
          this.reports.delete(reportKey(ev.args.lotId, ev.args.buyer))
          break
      }
    }
  }

  ingestBids(logs: Log[]) {
    for (const ev of parseEventLogs({ abi: continuousClearingAuctionAbi, logs, eventName: "BidSubmitted" })) {
      const lotId = this.byAuction.get(lower(ev.address))
      if (lotId === undefined) continue // not one of ours
      this.bids.get(lotId)!.set(ev.args.id, lower(ev.args.owner))
    }
  }
}
