import { fromKey, fromQ96, type LotStatus, type Persona } from "@fairtown/shared"
import { ARKIV_SCHEMAS as S } from "@fairtown/shared/arkiv"
import type { Address, Hex } from "viem"
import type { ChainAdapter, ChainEvent, EventArgs } from "../chain/types"
import type { ArkivStore } from "./ArkivStore"

const BLOCK_SECONDS = 2
const DAY = 86_400
const lc = (a: string) => a.toLowerCase() as Address
const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
const today = (now: Date) => now.toISOString().slice(0, 10)

export type LedgerWriterOptions = {
  chain: ChainAdapter
  arkiv: ArkivStore
  writer: Address
  // Lot details for the `lot` entity (photo hashes, grade report, 0G request id), looked up by metadata URI.
  detailsFor?: (metadataURI: string) => unknown
  // Walk-ins have no Arkiv funds, so the writer writes their bids (documented in arkiv/schema.md).
  hasArkivFunds?: (owner: Address) => boolean
  onError?: (e: unknown, event: string) => void
  now?: () => Date
  retryDelaysMs?: number[] // Arkiv write retries; writes dedupe on their natural key, so a retry never duplicates
}

type LotInfo = {
  key?: Hex
  seller: Address
  auction: Address
  sector: string
  commodity: string
  grade: string
  market: string
  place: string
  currency: string
  endBlock: bigint
}

// Chain is the truth for money. This mirrors chain events into Arkiv as the public record.
export class LedgerWriter {
  private readonly lots = new Map<string, LotInfo>()
  private queue: Promise<void> = Promise.resolve()
  private stop?: () => void
  readonly written: Record<string, number> = {}
  readonly failed: Record<string, number> = {}
  readonly retried: Record<string, number> = {}
  pending = 0

  constructor(private readonly o: LedgerWriterOptions) {}

  start() {
    this.stop = this.o.chain.watch((e) => this.enqueue(e))
    return () => this.stop?.()
  }
  // Resolves when every event seen so far has been written.
  idle() {
    return this.queue
  }

  enqueue(e: ChainEvent) {
    this.pending++
    this.queue = this.queue
      .then(() => this.handle(e))
      .catch((err) => this.o.onError?.(err, e.eventName))
      .finally(() => this.pending--)
  }

  async writeAgent(p: Persona, owner: Address) {
    await this.put("agent", { role: p.role, name: p.name, building: p.building, mandate: json(p.mandate ?? {}) }, owner, 30 * DAY, {
      name: p.name,
    })
  }

  private async put(schema: keyof typeof S, values: Record<string, string | bigint | Uint8Array>, owner: Address, seconds: number, dedupe?: Record<string, string | bigint>, key?: Hex) {
    const delays = this.o.retryDelaysMs ?? [1000, 3000]
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.o.arkiv.put(S[schema], values, { owner, expiresInSeconds: seconds, ...(dedupe ? { dedupe } : {}), ...(key ? { key } : {}) })
        this.written[schema] = (this.written[schema] ?? 0) + 1
        return r.key
      } catch (e) {
        if (attempt >= delays.length) {
          this.failed[schema] = (this.failed[schema] ?? 0) + 1
          throw e
        }
        this.retried[schema] = (this.retried[schema] ?? 0) + 1
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
  }

  private async secondsUntil(block: bigint, extra: number) {
    const now = await this.o.chain.blockNumber()
    return Math.max(60, Number(block > now ? block - now : 0n) * BLOCK_SECONDS + extra)
  }

  private async status(lotId: bigint, status: LotStatus) {
    const lot = this.lots.get(lotId.toString())
    if (!lot?.key) return
    await this.put("lot", { status }, lot.seller, DAY, undefined, lot.key)
  }

  private async handle(e: ChainEvent) {
    const now = this.o.now?.() ?? new Date()
    switch (e.eventName) {
      case "LotListed": {
        const a = e.args
        const info: LotInfo = {
          seller: lc(a.seller),
          auction: lc(a.auction),
          sector: fromKey(a.sector),
          commodity: fromKey(a.commodity),
          grade: "na",
          market: fromKey(a.market),
          place: fromKey(a.place),
          currency: currencyOf(a.currency),
          endBlock: a.endBlock,
        }
        const details = this.o.detailsFor?.(a.metadataURI) as { grade?: string } | undefined
        if (details?.grade) info.grade = details.grade
        info.key = await this.put(
          "lot",
          {
            sector: info.sector,
            commodity: info.commodity,
            grade: info.grade,
            market: info.market,
            place: info.place,
            currency: info.currency,
            status: "open",
            lotId: a.lotId,
            auction: lc(a.auction),
            floorPerUnit: a.floorPerUnit,
            endBlock: a.endBlock,
            parentLotId: a.parentLotId,
            details: json({ metadataURI: a.metadataURI, ...(details ?? {}) }),
          },
          info.seller,
          await this.secondsUntil(a.endBlock, DAY),
          { lotId: a.lotId },
        )
        this.lots.set(a.lotId.toString(), info)
        if (info.sector === "truck" || info.sector === "storage") {
          await this.put(
            "capacity",
            {
              kind: info.sector,
              fromMarket: info.market,
              toPlace: info.place,
              qty: a.qty,
              readyByBlock: a.endBlock,
              lotId: a.lotId,
              notes: a.parentLotId > 0n ? `for lot ${a.parentLotId}` : "",
            },
            info.seller,
            await this.secondsUntil(a.endBlock, DAY),
            { lotId: a.lotId },
          )
        }
        return
      }
      case "BidSubmitted": {
        const lot = [...this.lots.entries()].find(([, l]) => l.auction === lc(e.address))
        const lotId = lot ? BigInt(lot[0]) : 0n
        const owner = this.o.hasArkivFunds?.(lc(e.args.owner)) === false ? this.o.writer : lc(e.args.owner)
        await this.put(
          "bid",
          { lotId, agent: lc(e.args.owner), maxPerUnit: fromQ96(e.args.priceQ96), amount: e.args.amount, block: e.blockNumber, reason: "" },
          owner,
          lot ? await this.secondsUntil(lot[1].endBlock, 3600) : 3600,
          { lotId, agent: lc(e.args.owner), block: e.blockNumber, maxPerUnit: fromQ96(e.args.priceQ96) },
        )
        return
      }
      case "LotSettled": {
        const a = e.args
        await this.status(a.lotId, a.soldUnits > 0n ? "sold" : "unsold")
        const lot = this.lots.get(a.lotId.toString())
        if (!lot || a.soldUnits === 0n) return
        await this.put(
          "price",
          {
            sector: lot.sector,
            commodity: lot.commodity,
            grade: lot.grade,
            market: lot.market,
            place: lot.place,
            currency: lot.currency,
            lotId: a.lotId,
            finalClearingPerUnit: a.finalClearingPerUnit,
            avgPerUnit: a.avgPerUnit,
            soldUnits: a.soldUnits,
            day: today(now),
            tx: e.transactionHash,
          },
          this.o.writer,
          180 * DAY,
          { lotId: a.lotId },
        )
        return
      }
      case "SellerRecordUpdated": {
        const a: EventArgs<"SellerRecordUpdated"> = e.args
        await this.put(
          "reputation",
          {
            seller: lc(a.seller),
            tier: a.proven ? "proven" : "new",
            cleanLots: BigInt(a.cleanLots),
            noShows: BigInt(a.noShows),
            day: today(now),
            lastLotId: 0n,
            tx: e.transactionHash,
          },
          this.o.writer,
          180 * DAY,
          // One entity per record state per day, so a replayed event after a restart never duplicates it.
          { seller: lc(a.seller), cleanLots: BigInt(a.cleanLots), noShows: BigInt(a.noShows), day: today(now) },
        )
        return
      }
      case "DemandSignal": {
        const a = e.args
        await this.put(
          "signal",
          { kind: fromKey(a.signalKind), place: fromKey(a.place), severity: BigInt(a.severity), expiresAtBlock: a.expiresAtBlock, label: a.label },
          this.o.writer,
          await this.secondsUntil(a.expiresAtBlock, 0),
          { kind: fromKey(a.signalKind), place: fromKey(a.place), expiresAtBlock: a.expiresAtBlock },
        )
        return
      }
      case "LotRelisted":
        return this.status(e.args.lotId, "relisted")
      case "CarrierAssigned":
        return this.status(e.args.lotId, "truck_booked")
      case "HandoverConfirmed": {
        const lot = this.lots.get(e.args.lotId.toString())
        return lot && this.status(e.args.lotId, "picked_up")
      }
      case "LotDelivered":
        return this.status(e.args.lotId, "delivered")
      case "LotPaidInFull":
        return this.status(e.args.lotId, "paid_in_full")
      case "NoShowReported":
        return this.status(e.args.lotId, "no_show_reported")
      case "DisputeOpened":
        return this.status(e.args.lotId, "disputed")
      case "NoShowRefunded":
        return this.status(e.args.lotId, "refunded")
      case "RulingSettled":
        return this.status(e.args.lotId, e.args.refundToBuyer > 0n ? "refunded" : "paid_in_full")
      default:
        return
    }
  }
}

// FakeChain and the deployment use fixed currency addresses; S2 3.1 maps real ones from deployments/*.json.
const CURRENCY_BY_ADDRESS: Record<string, string> = {
  "0xc000000000000000000000000000000000000001": "USD",
  "0xc000000000000000000000000000000000000002": "EUR",
  "0xc000000000000000000000000000000000000003": "USDC",
}
export const registerCurrency = (address: string, code: string) => (CURRENCY_BY_ADDRESS[address.toLowerCase()] = code)
const currencyOf = (address: string) => CURRENCY_BY_ADDRESS[address.toLowerCase()] ?? address.toLowerCase()
