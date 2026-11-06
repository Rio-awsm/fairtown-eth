import type { LotListedEvent, TownEnvelope, TownSnapshot } from "@fairtown/shared/protocol"

// What the bot knows about the town, from the relay: lots (seller, currency, status, clearing), the current block,
// the bot users' own bids (for outbid alerts) and no-show reports (so a seller can contest).
export type LotRow = Omit<LotListedEvent, "type"> & { status: string; clearingPerUnit?: string; bids: number }
export type MyBid = { user: number; maxPerUnit: bigint; outbidSent: boolean }

const lc = (s: string) => s.toLowerCase()

export class Market {
  readonly lots = new Map<string, LotRow>()
  block = 0
  private readonly bids = new Map<string, MyBid[]>() // lotId -> bot users' bids
  private readonly reports = new Map<string, string>() // lotId -> buyer who reported a no-show

  seed(s: TownSnapshot) {
    this.block = Math.max(this.block, s.block)
    for (const l of s.lots) {
      this.lots.set(l.lotId, { ...l, seller: lc(l.seller) }) // extra snapshot fields are harmless
    }
  }

  apply(env: TownEnvelope) {
    if (env.block !== undefined) this.block = Math.max(this.block, env.block)
    const e = env.event
    const lot = "lotId" in e && e.lotId ? this.lots.get(e.lotId) : undefined
    switch (e.type) {
      case "clock":
        this.block = Math.max(this.block, e.block)
        break
      case "lot.listed": {
        this.lots.set(e.lotId, { ...e, seller: lc(e.seller), status: "open", bids: 0 })
        break
      }
      case "bid.placed":
        if (lot) lot.bids++
        break
      case "price.tick":
        if (lot) lot.clearingPerUnit = e.clearingPerUnit
        break
      case "lot.settled":
        if (lot) {
          lot.status = BigInt(e.soldUnits) > 0n ? "sold" : "unsold"
          lot.clearingPerUnit = e.finalClearingPerUnit
        }
        break
      case "lot.relisted":
        if (lot) lot.status = "relisted"
        break
      case "noshow.reported":
        this.reports.set(e.lotId, lc(e.buyer))
        if (lot) lot.status = "no_show_reported"
        break
      case "lot.paid_in_full":
        if (lot) lot.status = "paid_in_full"
        break
    }
  }

  open(): LotRow[] {
    return [...this.lots.values()].filter((l) => l.status === "open" && l.endBlock > this.block).sort((a, b) => a.endBlock - b.endBlock)
  }
  sellerOf(lotId: string) {
    return this.lots.get(lotId)?.seller
  }
  reporterOf(lotId: string) {
    return this.reports.get(lotId)
  }

  recordBid(lotId: string, user: number, maxPerUnit: bigint) {
    // One entry per user per lot: the highest max they bid, re-armed for an outbid alert.
    const list = this.bids.get(lotId) ?? []
    const mine = list.find((b) => b.user === user)
    if (mine) {
      if (maxPerUnit > mine.maxPerUnit) mine.maxPerUnit = maxPerUnit
      mine.outbidSent = false
    } else list.push({ user, maxPerUnit, outbidSent: false })
    this.bids.set(lotId, list)
  }
  bidsOn(lotId: string): MyBid[] {
    return this.bids.get(lotId) ?? []
  }
  myLots(user: number): string[] {
    return [...this.bids].filter(([, list]) => list.some((b) => b.user === user)).map(([id]) => id)
  }
}
