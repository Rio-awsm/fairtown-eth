import { BUILDINGS, MARKET_OF_SECTOR, SECTORS, SIGNAL_KINDS, UNITS, fromKey, type Building, type Sector, type SignalKind, type TownEnvelope, type TownEvent } from "@fairtown/shared"
import { fromQ96 } from "@fairtown/shared/units"
import type { Hex } from "viem"

// A decoded contract log, as viem's parseEventLogs (or FakeChain) produces it. Bigints may arrive as strings over the bridge.
export type RawChainEvent = {
  eventName: string
  args: Record<string, unknown>
  address: string
  blockNumber: bigint | string | number
  transactionHash: string
  logIndex: number
}

export type MapperContext = {
  currencyOf: (address: string) => string
  nameOf: (address: string) => string | undefined
  gradeOf?: (lotId: bigint) => Promise<string | undefined>
  now?: () => number
}

type LotInfo = { lotId: bigint; sector: Sector; auction: string }

const big = (v: unknown) => BigInt(String(v))
const num = (v: unknown) => Number(String(v))
const dec = (v: unknown) => big(v).toString()
const lc = (v: unknown) => String(v).toLowerCase()
const key = (v: unknown) => fromKey(String(v) as Hex)
const asBuilding = (s: string): Building => ((BUILDINGS as readonly string[]).includes(s) ? (s as Building) : "town_gate")
const asSector = (s: string): Sector => ((SECTORS as readonly string[]).includes(s) ? (s as Sector) : "produce")
const ceilFromQ96 = (q: bigint) => (q * 10n ** 18n + 2n ** 96n - 1n) / 2n ** 96n

// Only the relay turns chain logs into town events (contract 12.4). Deterministic ids make replays and reconnects dedupe.
export class ChainMapper {
  private readonly lots = new Map<string, LotInfo>()
  private readonly byAuction = new Map<string, bigint>()
  private readonly lastTick = new Map<string, string>()

  constructor(private readonly ctx: MapperContext) {}

  openAuctions() {
    return [...this.lots.values()]
  }
  lotOfAuction(auction: string) {
    return this.byAuction.get(lc(auction))
  }

  // A price tick for a lot, only when the clearing price changed.
  tick(lotId: bigint, clearingPerUnit: bigint, block?: number): TownEnvelope | undefined {
    const k = lotId.toString()
    const v = clearingPerUnit.toString()
    if (this.lastTick.get(k) === v) return undefined
    this.lastTick.set(k, v)
    return this.envelope({ type: "price.tick", lotId: k, clearingPerUnit: v }, `tick-${k}-${v}`, block)
  }

  forget(lotId: bigint) {
    const info = this.lots.get(lotId.toString())
    if (info) this.byAuction.delete(info.auction)
    this.lots.delete(lotId.toString())
  }

  async map(e: RawChainEvent): Promise<TownEnvelope[]> {
    const a = e.args
    const block = num(e.blockNumber)
    const id = `chain-${e.transactionHash}-${e.logIndex}`
    const one = (event: TownEvent) => [this.envelope(event, id, block)]
    switch (e.eventName) {
      case "LotListed": {
        const lotId = big(a.lotId)
        const sector = asSector(key(a.sector))
        this.lots.set(lotId.toString(), { lotId, sector, auction: lc(a.auction) })
        this.byAuction.set(lc(a.auction), lotId)
        const grade = (await this.ctx.gradeOf?.(lotId).catch(() => undefined)) ?? "na"
        return one({
          type: "lot.listed",
          lotId: lotId.toString(),
          building: (BUILDINGS as readonly string[]).includes(key(a.market)) ? (key(a.market) as Building) : MARKET_OF_SECTOR[sector],
          sector,
          commodity: key(a.commodity),
          qty: num(a.qty),
          unit: UNITS[sector],
          currency: this.ctx.currencyOf(lc(a.currency)),
          place: key(a.place),
          floorPerUnit: dec(a.floorPerUnit),
          seller: lc(a.seller),
          sellerName: this.ctx.nameOf(lc(a.seller)) ?? short(lc(a.seller)),
          auction: lc(a.auction),
          endBlock: num(a.endBlock),
          parentLotId: dec(a.parentLotId),
          grade,
        })
      }
      case "BidSubmitted": {
        const lotId = this.byAuction.get(lc(e.address))
        if (lotId === undefined) return []
        return one({
          type: "bid.placed",
          lotId: lotId.toString(),
          agentId: lc(a.owner),
          maxPerUnit: fromQ96(big(a.priceQ96)).toString(),
          amount: dec(a.amount),
          tx: e.transactionHash,
        })
      }
      case "ClearingPriceUpdated": {
        const lotId = this.byAuction.get(lc(e.address))
        if (lotId === undefined) return []
        const t = this.tick(lotId, ceilFromQ96(big(a.clearingPriceQ96)), block)
        return t ? [t] : []
      }
      case "LotSettled":
        return one({
          type: "lot.settled",
          lotId: dec(a.lotId),
          finalClearingPerUnit: dec(a.finalClearingPerUnit),
          avgPerUnit: dec(a.avgPerUnit),
          soldUnits: dec(a.soldUnits),
          sellerPaid: dec(a.sellerPaid),
          held: dec(a.held),
          fee: dec(a.fee),
          advanceBps: num(a.advanceBps),
          pickupDeadline: num(a.pickupDeadline),
          tx: e.transactionHash,
        })
      case "LotRelisted":
        return one({ type: "lot.relisted", lotId: dec(a.lotId), newLotId: dec(a.newLotId), newFloorPerUnit: dec(a.newFloorPerUnit) })
      case "TransportNeeded":
        return one({ type: "transport.needed", lotId: dec(a.lotId), fromBuilding: asBuilding(key(a.fromMarket)), place: key(a.place), qty: dec(a.qty) })
      case "StorageNeeded":
        return one({ type: "storage.needed", lotId: dec(a.lotId), requester: lc(a.requester), qty: dec(a.qty), days: num(a.days_) })
      case "CarrierAssigned":
        return one({ type: "carrier.assigned", lotId: dec(a.lotId), truckLotId: dec(a.truckLotId), carrier: lc(a.carrier) })
      case "HandoverConfirmed":
        return one({ type: "handover.confirmed", lotId: dec(a.lotId), buyer: lc(a.buyer), receiver: lc(a.receiver), releasedToSeller: dec(a.releasedToSeller), tx: e.transactionHash })
      case "LotPaidInFull":
        return one({ type: "lot.paid_in_full", lotId: dec(a.lotId) })
      case "LotDelivered":
        return one({ type: "lot.delivered", lotId: dec(a.lotId), truckLotId: dec(a.truckLotId) })
      case "NoShowReported":
        return one({ type: "noshow.reported", lotId: dec(a.lotId), buyer: lc(a.buyer), contestEnds: num(a.contestEnds) })
      case "NoShowContested":
        return one({ type: "noshow.contested", lotId: dec(a.lotId), buyer: lc(a.buyer), disputeId: dec(a.disputeId) })
      case "NoShowRefunded":
        return one({ type: "noshow.refunded", lotId: dec(a.lotId), seller: lc(a.seller), buyer: lc(a.buyer), refund: dec(a.refund) })
      case "SellerRecordUpdated":
        return one({ type: "seller.record", seller: lc(a.seller), cleanLots: num(a.cleanLots), noShows: num(a.noShows), proven: Boolean(a.proven) })
      case "DisputeOpened":
        return one({ type: "dispute.opened", disputeId: dec(a.disputeId), lotId: dec(a.lotId), buyer: lc(a.buyer), kind: num(a.kind) === 1 ? "no_show" : "quality" })
      case "DisputeResolved":
        return one({ type: "dispute.resolved", disputeId: dec(a.disputeId), lotId: dec(a.lotId), refundBps: num(a.refundBps) })
      case "DemandSignal": {
        const kind = key(a.signalKind)
        if (!(SIGNAL_KINDS as readonly string[]).includes(kind)) return []
        return one({ type: "signal", id: dec(a.id), kind: kind as SignalKind, place: key(a.place), severity: num(a.severity), label: String(a.label), expiresAtBlock: num(a.expiresAtBlock) })
      }
      case "ReferencePriceUpdated":
        return one({ type: "reference.updated", commodity: key(a.commodity), market: key(a.market), perUnit: dec(a.perUnit), currency: key(a.currencyCode), source: key(a.sourceTag) })
      case "FxUpdated":
        return one({ type: "fx.updated", currency: key(a.currencyCode), perUsd: num(a.perUsdE8) / 1e8 })
      default:
        // AgentRegistered (agents announce spawns), HeldReleased, RulingSettled and CCA internals have no town event.
        return []
    }
  }

  private envelope(event: TownEvent, id: string, block?: number): TownEnvelope {
    return { v: 1, id, ts: this.ctx.now?.() ?? Date.now(), ...(block !== undefined ? { block } : {}), source: "chain", event }
  }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
