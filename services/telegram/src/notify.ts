import type { TownEnvelope } from "@fairtown/shared/protocol"
import { GrammyError } from "grammy"
import type { Links } from "./links"
import type { Log } from "./log"
import type { Market } from "./market"
import { formatBase, formatMoney } from "./money"

// TG 2.1 / 3.2: relay events become messages for the bot users they concern. Sellers hear about their lots, buyers
// about lots they bid on and their handovers, drivers about transport. Busy events (bids, transport requests) are
// throttled per user so a lively auction doesn't flood the chat.
export const THROTTLE_MS = 60_000
export type Send = (user: number, text: string) => Promise<void>

const pretty = (id: string) =>
  id
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ")

export class Throttle {
  private readonly last = new Map<string, { at: number; skipped: number }>()
  constructor(
    private readonly now: () => number,
    private readonly ms = THROTTLE_MS,
  ) {}
  // undefined = stay quiet; a number = send now, with how many were held back since the last one.
  take(key: string): number | undefined {
    const t = this.now()
    const l = this.last.get(key)
    if (l && t - l.at < this.ms) {
      l.skipped++
      return undefined
    }
    this.last.set(key, { at: t, skipped: 0 })
    return l?.skipped ?? 0
  }
}

export class Notifier {
  private readonly throttle: Throttle
  constructor(private readonly d: { links: Links; market: Market; send: Send; now: () => number; throttleMs?: number }) {
    this.throttle = new Throttle(d.now, d.throttleMs)
  }

  private money(lotId: string, v: string | bigint) {
    const l = this.d.market.lots.get(lotId)
    return l ? formatMoney(v, l.currency) : formatBase(BigInt(v))
  }
  private per(lotId: string) {
    const l = this.d.market.lots.get(lotId)
    return l ? ` per ${l.unit}` : " per unit"
  }
  private sellerUsers(lotId: string) {
    const s = this.d.market.sellerOf(lotId)
    return s ? this.d.links.usersFor(s) : []
  }
  private async tell(users: number[], text: string) {
    for (const u of new Set(users)) await this.d.send(u, text)
  }

  async handle(env: TownEnvelope) {
    const e = env.event
    const m = this.d.market
    switch (e.type) {
      case "bid.placed": {
        if (this.d.links.usersFor(e.agentId).length) return // a bot user's own bid: the bot already answered
        for (const u of this.sellerUsers(e.lotId)) {
          const held = this.throttle.take(`${u}:bid:${e.lotId}`)
          if (held === undefined) continue
          await this.d.send(u, `New bid on your lot #${e.lotId}: up to ${this.money(e.lotId, e.maxPerUnit)}${this.per(e.lotId)}.${held ? ` (${held} more since the last update.)` : ""}`)
        }
        return
      }
      case "price.tick": {
        const clearing = BigInt(e.clearingPerUnit)
        for (const b of m.bidsOn(e.lotId)) {
          if (b.outbidSent || clearing <= b.maxPerUnit) continue
          b.outbidSent = true
          await this.d.send(b.user, `You're outbid on lot #${e.lotId}: the price is now ${this.money(e.lotId, clearing)}${this.per(e.lotId)}, above your max of ${this.money(e.lotId, b.maxPerUnit)}. Send /bid ${e.lotId} to bid again.`)
        }
        return
      }
      case "lot.settled": {
        const sold = BigInt(e.soldUnits) > 0n
        await this.tell(
          this.sellerUsers(e.lotId),
          sold
            ? `Lot #${e.lotId} sold ${formatBase(BigInt(e.soldUnits) * 1_000_000n)} units at ${this.money(e.lotId, e.finalClearingPerUnit)}${this.per(e.lotId)}. Paid to you now: ${this.money(e.lotId, e.sellerPaid)}. Held until pickup: ${this.money(e.lotId, e.held)} (fee ${this.money(e.lotId, e.fee)}). Pickup deadline: block ${e.pickupDeadline}. Hand over with /qr ${e.lotId}.`
            : `Lot #${e.lotId} closed without a sale. Nothing was paid or held.`,
        )
        await this.tell(
          m.bidsOn(e.lotId).map((b) => b.user),
          sold
            ? `Lot #${e.lotId} closed at ${this.money(e.lotId, e.finalClearingPerUnit)}${this.per(e.lotId)}. If you won some, collect it from the seller before block ${e.pickupDeadline}: get their handover code and send /receive <code>.`
            : `Lot #${e.lotId} closed without a sale. Any money you bid is returned.`,
        )
        return
      }
      case "lot.relisted":
        return this.tell(this.sellerUsers(e.lotId), `Lot #${e.lotId} didn't fully sell, so the rest is relisted as lot #${e.newLotId} at a floor of ${this.money(e.lotId, e.newFloorPerUnit)}${this.per(e.lotId)}.`)
      case "transport.needed": {
        for (const [u, l] of this.d.links.all()) {
          if (l.role !== "TRUCK" || this.throttle.take(`${u}:transport`) === undefined) continue
          await this.d.send(u, `Transport needed: lot #${e.lotId}, ${formatBase(BigInt(e.qty) * 1_000_000n)} units from ${pretty(e.fromBuilding)} (${pretty(e.place)}). To offer space, /sell your truck capacity.`)
        }
        return
      }
      case "carrier.assigned":
        await this.tell(this.d.links.usersFor(e.carrier), `You're booked to carry lot #${e.lotId} (your truck lot #${e.truckLotId}). At pickup, get the seller's handover code and send /receive <code>. At drop-off, show the buyer /qr ${e.truckLotId}.`)
        return this.tell(this.sellerUsers(e.lotId), `A truck is booked for lot #${e.lotId}. Show the driver your handover code at pickup: /qr ${e.lotId}.`)
      case "handover.confirmed":
        await this.tell(this.sellerUsers(e.lotId), `Handover done for lot #${e.lotId}: ${this.money(e.lotId, e.releasedToSeller)} released to you.`)
        await this.tell(this.d.links.usersFor(e.receiver), `Handover for lot #${e.lotId} confirmed.`)
        if (e.buyer.toLowerCase() !== e.receiver.toLowerCase()) await this.tell(this.d.links.usersFor(e.buyer), `Your goods from lot #${e.lotId} were picked up by the carrier.`)
        return
      case "lot.delivered":
        await this.tell(this.sellerUsers(e.truckLotId), `Lot #${e.lotId} delivered. Your truck lot #${e.truckLotId} is done.`)
        return this.tell(this.sellerUsers(e.lotId), `Lot #${e.lotId} was delivered to the buyer.`)
      case "lot.paid_in_full":
        return this.tell(this.sellerUsers(e.lotId), `Lot #${e.lotId} is paid in full.`)
      case "noshow.reported":
        return this.tell(this.sellerUsers(e.lotId), `A buyer reports you didn't hand over lot #${e.lotId}. If you did, contest it with photos before block ${e.contestEnds}: /contest ${e.lotId}. Otherwise their share of the held money is refunded.`)
      case "noshow.contested":
        return this.tell(this.d.links.usersFor(e.buyer), `The seller contested your no-show report on lot #${e.lotId}. A ruling follows.`)
      case "noshow.refunded":
        await this.tell(this.d.links.usersFor(e.buyer), `Refund on lot #${e.lotId}: ${this.money(e.lotId, e.refund)} back to you.`)
        return this.tell(this.d.links.usersFor(e.seller), `Lot #${e.lotId}: the buyer was refunded ${this.money(e.lotId, e.refund)} of the held money, and your record shows a no-show.`)
      case "dispute.opened":
        return this.tell(this.sellerUsers(e.lotId), `A buyer disputed lot #${e.lotId} (${e.kind === "quality" ? "quality" : "no-show"}). A ruling follows.`)
      case "dispute.resolved":
        return this.tell(this.sellerUsers(e.lotId), `Ruling on lot #${e.lotId}: ${e.refundBps / 100}% of the disputed held share goes back to the buyer.`)
      case "seller.record":
        return this.tell(this.d.links.usersFor(e.seller), `Your record: ${e.cleanLots} clean lot${e.cleanLots === 1 ? "" : "s"}, ${e.noShows} no-show${e.noShows === 1 ? "" : "s"}, ${e.proven ? "proven seller (90% at the sale)" : "new seller"}.`)
    }
  }
}

// One message at a time, with a short gap, so a burst stays under Telegram's limits. A user who blocked the bot is
// forgotten; a 429 waits as long as Telegram asks, once.
export function sendQueue(o: { sendMessage: (chatId: number, text: string) => Promise<unknown>; links: Links; log: Log; gapMs?: number; sleep?: (ms: number) => Promise<void> }): Send {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let chain: Promise<unknown> = Promise.resolve()
  const one = async (user: number, text: string) => {
    for (let tries = 0; tries < 2; tries++) {
      try {
        await o.sendMessage(user, text)
        break
      } catch (e) {
        if (e instanceof GrammyError && e.error_code === 429 && tries === 0) {
          await sleep(((e.parameters.retry_after ?? 1) as number) * 1000)
          continue
        }
        if (e instanceof GrammyError && e.error_code === 403) {
          o.links.forget(user)
          o.log.info("user blocked the bot; link forgotten")
        } else o.log.warn("notification failed", { detail: e instanceof GrammyError ? e.description : e instanceof Error ? e.message : String(e) })
        break
      }
    }
    await sleep(o.gapMs ?? 40)
  }
  return (user, text) => {
    const next = chain.then(() => one(user, text))
    chain = next.catch(() => undefined)
    return next
  }
}
