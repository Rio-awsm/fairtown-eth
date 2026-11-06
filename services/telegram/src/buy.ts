import { toBase } from "@fairtown/shared/units"
import { InlineKeyboard, type Bot, type Context } from "grammy"
import { AgentsError, type AgentsClient, type LotInfo } from "./agents"
import { explain, ID_TEXT, uid } from "./identity"
import type { Links } from "./links"
import type { Log } from "./log"
import type { Market } from "./market"
import { formatBase, formatMoney } from "./money"

// TG 2.2: browse open lots and bid as a walk-in. The bot only proposes: every bid goes to POST /api/walkin/bid, where
// the agents runtime's guardrails (budget, 60% per auction, tick above clearing, rate limit) decide what reaches the
// chain. A bid card lapses after 5 minutes because prices move.
export const BID_WAIT_MS = 5 * 60_000
const LOT_ID = /^\d{1,12}$/
const AMOUNT = /^\d{1,12}([.,]\d{1,6})?$/

type BidState = { lotId: string; step: "price" | "confirm"; unit: string; currency: string; maxPerUnit?: bigint; amount?: bigint; expiresAt: number }

export class Bids {
  private readonly m = new Map<number, BidState>()
  constructor(private readonly now: () => number = Date.now) {}
  get(user: number) {
    const s = this.m.get(user)
    if (s && s.expiresAt <= this.now()) this.m.delete(user)
    return this.m.get(user)
  }
  set(user: number, s: Omit<BidState, "expiresAt">) {
    this.m.set(user, { ...s, expiresAt: this.now() + BID_WAIT_MS })
  }
  clear(user: number) {
    return this.m.delete(user)
  }
}

export type BuyDeps = { agents: AgentsClient; links: Links; market: Market; bids: Bids; log: Log }

const pretty = (id: string) =>
  id
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ")
const dec = (v: string) => toBase(v.replace(",", "."))

export const BUY_TEXT = {
  joinFirst: "Join as a buyer first: tap I buy on /start, or send /join.",
  sellersCant: "You're signed in as a seller. To bid, send /logout and /join as a buyer.",
  noLots: "No lots are open right now. I'll show them here as they list.",
  lotUsage: "Send /lot followed by a lot number, for example /lot 12",
  bidUsage: "Send /bid followed by a lot number, for example /bid 12",
  notOpen: (id: string, status: string) => `Lot #${id} isn't taking bids (${status.replace(/_/g, " ")}).`,
  wrongCurrency: (id: string, lot: string, mine: string) => `Lot #${id} trades in ${lot}, and your test money is ${mine}. Join again in ${lot} to bid on it.`,
  askBid: (s: BidState) => `Send your highest price per ${s.unit} in ${s.currency} and the most you'll spend in total, separated by a space. For example: 8.40 600\n(/cancel to stop)`,
  badBid: "Send two numbers: your max price per unit and your total, for example 8.40 600.",
  zero: "Both numbers must be above zero.",
  card: (s: BidState) =>
    [
      `Bid on lot #${s.lotId}: up to ${formatMoney(s.maxPerUnit!, s.currency)} per ${s.unit}, spending at most ${formatMoney(s.amount!, s.currency)}.`,
      "The market's guardrails check it before anything reaches the chain, and lower the amount if it's more than your budget or 60% of the auction allows. Test money only.",
    ].join("\n"),
  // The walk-in bid route returns only { bidId, tx }, not the amount after guardrail clamping, so don't claim it.
  placed: (s: BidState, bidId: string, tx: string) => `Bid #${bidId} placed on lot #${s.lotId} (the guardrails may have lowered the amount to fit). I'll tell you if you're outbid.\nTransaction: ${tx}`,
  rejected: (why: string) => `The guardrails stopped this bid: ${why}`,
  failed: "The bid didn't go through. Nothing was spent. Try again in a moment.",
  unsure: (id: string) => `The market didn't answer in time, so I can't tell whether the bid went in. Check /lot ${id} before bidding again.`,
  cancelled: "Bid cancelled. Nothing was sent.",
} as const

export function lotLine(l: { lotId: string; commodity: string; qty: number | string; unit: string; currency: string; floorPerUnit: string; clearingPerUnit?: string | undefined; place: string; bids?: number }, block?: number, endBlock?: number) {
  const price = l.clearingPerUnit && BigInt(l.clearingPerUnit) > 0n ? `now ${formatMoney(l.clearingPerUnit, l.currency)}` : `floor ${formatMoney(l.floorPerUnit, l.currency)}`
  const left = block !== undefined && endBlock !== undefined ? `, ${Math.max(0, endBlock - block)} blocks left` : ""
  return `#${l.lotId} ${l.qty} ${l.unit} ${l.commodity}, ${pretty(l.place)}: ${price} per ${l.unit}${l.bids !== undefined ? `, ${l.bids} bids` : ""}${left}`
}

export function lotDetail(l: LotInfo, unit: string, steps?: Array<{ name: string; status: string }>) {
  const c = l.spec.currency
  const s = l.settlement
  return [
    `Lot #${l.lotId}: ${l.spec.qty} ${unit} ${l.spec.commodity}, ${pretty(l.spec.place)} (${pretty(l.spec.market)})`,
    `Status: ${l.status.replace(/_/g, " ")}`,
    `Floor: ${formatMoney(l.spec.floorPerUnit, c)} per ${unit}`,
    ...(l.clearing && BigInt(l.clearing) > 0n ? [`Clearing: ${formatMoney(l.clearing, c)} per ${unit}`] : []),
    ...(l.bidCount !== undefined ? [`Bids: ${l.bidCount}`] : []),
    ...(s ? [`Sold ${formatBase(BigInt(s.soldUnits) * 1_000_000n)} at ${formatMoney(s.finalClearingPerUnit, c)}; paid at sale ${formatMoney(s.sellerPaid, c)}, still held ${formatMoney(s.heldRemaining, c)}; pickup by block ${s.pickupDeadline}`] : []),
    ...(steps?.length ? [`Steps: ${steps.map((x) => `${x.name} ${x.status === "done" ? "✓" : x.status === "current" ? "…" : "·"}`).join("  ")}`] : []),
  ].join("\n")
}

export function registerBuy(bot: Bot, d: BuyDeps) {
  const unitOf = (lotId: string) => d.market.lots.get(lotId)?.unit ?? "unit"

  bot.command("market", async (ctx) => {
    const open = d.market.open().slice(0, 10)
    if (!open.length) return ctx.reply(BUY_TEXT.noLots)
    const kb = new InlineKeyboard()
    open.forEach((l, i) => {
      kb.text(`Bid on #${l.lotId}`, `bid:${l.lotId}`)
      if (i % 2 === 1) kb.row()
    })
    await ctx.reply(["Open lots (test money):", ...open.map((l) => lotLine(l, d.market.block, l.endBlock))].join("\n"), { reply_markup: kb })
  })

  bot.command("lot", async (ctx) => {
    const id = ctx.match.trim().replace(/^#/, "")
    if (!LOT_ID.test(id)) return ctx.reply(BUY_TEXT.lotUsage)
    try {
      const [lot, tl] = await Promise.all([d.agents.lot(uid(ctx), id), d.agents.timeline(uid(ctx), id).catch(() => undefined)])
      const kb = lot.status === "open" ? { reply_markup: new InlineKeyboard().text(`Bid on #${id}`, `bid:${id}`) } : {}
      await ctx.reply(lotDetail(lot, unitOf(id), tl?.steps), kb)
    } catch (e) {
      if (e instanceof AgentsError && (e.status === 404 || e.code === "unknown_lot")) return ctx.reply(`There's no lot #${id}.`)
      await ctx.reply(explain(e, d))
    }
  })

  async function startBid(ctx: Context, id: string) {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l) return ctx.reply(BUY_TEXT.joinFirst)
    if (l.role !== "HUMAN") return ctx.reply(BUY_TEXT.sellersCant)
    if (!d.links.session(user)) return ctx.reply(ID_TEXT.ended(l))
    let lot: LotInfo
    try {
      lot = await d.agents.lot(user, id)
    } catch (e) {
      if (e instanceof AgentsError && e.status === 404) return ctx.reply(`There's no lot #${id}.`)
      return ctx.reply(explain(e, d))
    }
    if (lot.status !== "open") return ctx.reply(BUY_TEXT.notOpen(id, lot.status))
    if (lot.spec.currency !== l.currency) return ctx.reply(BUY_TEXT.wrongCurrency(id, lot.spec.currency, l.currency))
    const s = { lotId: id, step: "price" as const, unit: unitOf(id), currency: l.currency }
    d.bids.set(user, s)
    await ctx.reply(BUY_TEXT.askBid({ ...s, expiresAt: 0 }))
  }

  bot.command("bid", async (ctx) => {
    const id = ctx.match.trim().replace(/^#/, "")
    if (!LOT_ID.test(id)) return ctx.reply(BUY_TEXT.bidUsage)
    return startBid(ctx, id)
  })
  bot.callbackQuery(/^bid:(\d{1,12})$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    return startBid(ctx, ctx.match[1]!)
  })

  bot.on("message:text", async (ctx, next) => {
    const user = uid(ctx)
    const s = d.bids.get(user)
    if (!s || ctx.msg.text.startsWith("/")) return next()
    if (s.step === "confirm") return ctx.reply("Use the buttons on the bid, or send /cancel.")
    const parts = ctx.msg.text.trim().split(/\s+/)
    if (parts.length !== 2 || !parts.every((p) => AMOUNT.test(p))) return ctx.reply(BUY_TEXT.badBid)
    const maxPerUnit = dec(parts[0]!)
    const amount = dec(parts[1]!)
    if (maxPerUnit <= 0n || amount <= 0n) return ctx.reply(BUY_TEXT.zero)
    const next2 = { ...s, step: "confirm" as const, maxPerUnit, amount }
    d.bids.set(user, next2)
    await ctx.reply(BUY_TEXT.card(next2), {
      reply_markup: new InlineKeyboard().text("Place bid", `bid:ok:${s.lotId}`).text("Cancel", `bid:no:${s.lotId}`),
    })
  })

  bot.callbackQuery(/^bid:(ok|no):(\d{1,12})$/, async (ctx) => {
    const user = uid(ctx)
    const [, action, id] = ctx.match
    const s = d.bids.get(user)
    if (!s || s.step !== "confirm" || s.lotId !== id) return ctx.answerCallbackQuery({ text: "This button has expired." })
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup().catch(() => undefined)
    if (action === "no") {
      d.bids.clear(user)
      return ctx.reply(BUY_TEXT.cancelled)
    }
    const l = d.links.get(user)
    const token = d.links.session(user)
    if (!l || l.role !== "HUMAN" || !token) {
      d.bids.clear(user)
      return ctx.reply(l ? ID_TEXT.ended(l) : BUY_TEXT.joinFirst)
    }
    try {
      const r = await d.links.exclusive(user, () => d.agents.bid(user, { token, lotId: s.lotId, maxPerUnit: s.maxPerUnit!.toString(), amount: s.amount!.toString() }))
      if (r === "busy") return ctx.reply(ID_TEXT.busy)
      d.bids.clear(user)
      d.market.recordBid(s.lotId, user, s.maxPerUnit!)
      return ctx.reply(BUY_TEXT.placed(s, r.bidId, r.tx))
    } catch (e) {
      d.bids.clear(user)
      if (e instanceof AgentsError) {
        if (e.code === "bid_rejected") return ctx.reply(BUY_TEXT.rejected(e.message))
        if (e.code === "bid_failed") return ctx.reply(BUY_TEXT.failed)
        if (e.code === "no_session") {
          d.links.endSession(user)
          return ctx.reply(ID_TEXT.ended(l))
        }
        if (e.status === 0) return ctx.reply(BUY_TEXT.unsure(s.lotId)) // may have reached the chain: never retry blind
      }
      return ctx.reply(explain(e, d))
    }
  })
}
