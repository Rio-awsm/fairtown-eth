import type { TicketJson } from "@fairtown/shared/handover"
import { randomInt } from "node:crypto"
import { InlineKeyboard, InputFile, type Bot, type Context } from "grammy"
import { AgentsError, type AgentsClient, type LotInfo } from "./agents"
import { explain, ID_TEXT, uid } from "./identity"
import type { Link, Links } from "./links"
import type { Log } from "./log"
import { formatMoney } from "./money"

// TG 3.1 / 3.2: the QR handover from Telegram. The seller (or a driver at drop-off) asks for /qr <lot>; the agents
// service signs a ticket for one buyer and amount, valid about 5 minutes. The bot shows it as a QR (for the web scan page
// and phones), the scan link, and a 6-digit code. A receiver using the bot (walk-in buyer or carrier) sends
// /receive <code>. The code is shown in person exactly like the QR, and the contract releases money only when the
// buyer or the assigned carrier named in the ticket confirms, so a guessed code is useless to anyone else.
export const CODE_MS = 5 * 60_000 // ticketValidBlocks is about 5 minutes (agents index.ts)
export const RECEIVE_TRIES = 5
export const RECEIVE_WINDOW_MS = 10 * 60_000

type Issued = { code: string; lotId: string; currency: string; ticket: TicketJson; expiresAt: number }

export class Codes {
  private readonly m = new Map<string, Issued>()
  private readonly tries = new Map<number, number[]>()
  constructor(
    private readonly now: () => number = Date.now,
    private readonly gen: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
  ) {}
  issue(lotId: string, currency: string, ticket: TicketJson): Issued {
    for (const [k, v] of this.m) if (v.expiresAt <= this.now()) this.m.delete(k)
    let code = this.gen()
    for (let i = 0; this.m.has(code) && i < 20; i++) code = this.gen()
    const it = { code, lotId, currency, ticket, expiresAt: this.now() + CODE_MS }
    this.m.set(code, it)
    return it
  }
  // Counts every attempt, right or wrong, against the user's allowance.
  attempt(user: number): boolean {
    const t = this.now()
    const recent = (this.tries.get(user) ?? []).filter((x) => x > t - RECEIVE_WINDOW_MS)
    if (recent.length >= RECEIVE_TRIES) return false
    recent.push(t)
    this.tries.set(user, recent)
    return true
  }
  peek(code: string): Issued | undefined {
    const it = this.m.get(code)
    if (it && it.expiresAt <= this.now()) {
      this.m.delete(code)
      return undefined
    }
    return it
  }
  spend(code: string) {
    this.m.delete(code)
  }
}

export type QrRender = (text: string) => Promise<Buffer>
export type HandoverDeps = { agents: AgentsClient; links: Links; codes: Codes; qr: QrRender; log: Log }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const tokensToUnits = (t: string) => {
  const v = BigInt(t)
  const whole = v / 10n ** 18n
  const frac = v % 10n ** 18n
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6)}`
}

export const HO_TEXT = {
  qrUsage: "Send /qr followed by your lot number, for example /qr 12",
  receiveUsage: "Send /receive followed by the 6-digit code the seller shows you, for example /receive 482193",
  sellersOnly: "Only the seller (or the driver, for a truck lot) can show a handover code. Sign in with /link.",
  receiversOnly: "Sign in as the buyer (/join) or the driver (/link) who is collecting.",
  notYours: (id: string) => `Lot #${id} isn't yours.`,
  nobody: (id: string) => `Nobody holds goods from lot #${id} right now, so there's nothing to hand over.`,
  pick: (id: string) => `Lot #${id} has several buyers. Who is collecting?`,
  issued: (id: string, code: string, url: string) =>
    [
      `Handover for lot #${id}. Show this to the buyer or their driver in person.`,
      `Code: ${code.slice(0, 3)} ${code.slice(3)} (they send /receive ${code} to this bot)`,
      `Or they scan the QR, or open: ${url}`,
      "Valid about 5 minutes. Ask again with /qr if it runs out.",
    ].join("\n"),
  noImage: "(The QR picture couldn't be drawn; the code and link above still work.)",
  tooMany: "Too many codes tried. Wait a few minutes, then try again.",
  badCode: "That code isn't valid or has run out. Ask the seller for a new one.",
  done: (id: string, released: string) => `Handover confirmed for lot #${id}. ${released} released to the seller.`,
  expired: "This handover code has run out. Ask the seller for a new one with /qr.",
  refused: (why: string) => `The handover didn't go through: ${why}. Check that you're the buyer or the booked driver.`,
  unsure: (id: string) => `The market didn't answer in time, so I can't tell whether the handover went through. Check /lot ${id}.`,
} as const

export function registerHandover(bot: Bot, d: HandoverDeps) {
  const seller = (ctx: Context): Extract<Link, { sellerId: string }> | string => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l || l.role === "HUMAN") return HO_TEXT.sellersOnly
    if (!d.links.session(user)) return ID_TEXT.ended(l)
    return l
  }

  async function issue(ctx: Context, lot: LotInfo, winner: { buyer: string; tokenAmount: string }) {
    const user = uid(ctx)
    const l = seller(ctx)
    if (typeof l === "string") return ctx.reply(l)
    const session = d.links.session(user)!
    try {
      const t = await d.agents.ticket(user, session, { sellerId: l.sellerId, lotId: lot.lotId, buyer: winner.buyer, tokenAmount: winner.tokenAmount })
      const it = d.codes.issue(lot.lotId, lot.spec.currency, t.ticket)
      const text = HO_TEXT.issued(lot.lotId, it.code, t.fallbackUrl)
      const png = await d.qr(t.qrText).catch((e: unknown) => {
        d.log.warn("QR render failed", { detail: e instanceof Error ? e.message : String(e) })
        return undefined
      })
      if (png) return ctx.replyWithPhoto(new InputFile(png, `lot-${lot.lotId}-handover.png`), { caption: text })
      return ctx.reply(`${text}\n${HO_TEXT.noImage}`)
    } catch (e) {
      if (e instanceof AgentsError && e.code === "no_session") {
        d.links.endSession(user)
        return ctx.reply(ID_TEXT.ended(l))
      }
      if (e instanceof AgentsError && ["not_your_lot", "nothing_held", "insufficient_tokens"].includes(e.code)) return ctx.reply(e.message)
      return ctx.reply(explain(e, d))
    }
  }

  async function lotFor(ctx: Context, id: string): Promise<LotInfo | undefined> {
    try {
      return await d.agents.lot(uid(ctx), id)
    } catch (e) {
      await ctx.reply(e instanceof AgentsError && e.status === 404 ? `There's no lot #${id}.` : explain(e, d))
      return undefined
    }
  }

  bot.command("qr", async (ctx) => {
    const id = ctx.match.trim().replace(/^#/, "")
    if (!/^\d{1,12}$/.test(id)) return ctx.reply(HO_TEXT.qrUsage)
    const l = seller(ctx)
    if (typeof l === "string") return ctx.reply(l)
    const lot = await lotFor(ctx, id)
    if (!lot) return
    if (lot.spec.seller.toLowerCase() !== l.address.toLowerCase()) return ctx.reply(HO_TEXT.notYours(id))
    const winners = (lot.winners ?? []).filter((w) => BigInt(w.tokenAmount) > 0n)
    if (!winners.length) return ctx.reply(HO_TEXT.nobody(id))
    if (winners.length === 1) return issue(ctx, lot, winners[0]!)
    const kb = new InlineKeyboard()
    winners.slice(0, 8).forEach((w) => kb.text(`${short(w.buyer)}: ${tokensToUnits(w.tokenAmount)} units`, `qr:${id}:${w.buyer.toLowerCase()}`).row())
    await ctx.reply(HO_TEXT.pick(id), { reply_markup: kb })
  })

  bot.callbackQuery(/^qr:(\d{1,12}):(0x[0-9a-f]{40})$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const [, id, buyer] = ctx.match
    const l = seller(ctx)
    if (typeof l === "string") return ctx.reply(l)
    const lot = await lotFor(ctx, id!)
    if (!lot) return
    if (lot.spec.seller.toLowerCase() !== l.address.toLowerCase()) return ctx.reply(HO_TEXT.notYours(id!))
    const w = (lot.winners ?? []).find((x) => x.buyer.toLowerCase() === buyer && BigInt(x.tokenAmount) > 0n)
    if (!w) return ctx.reply(HO_TEXT.nobody(id!))
    return issue(ctx, lot, w)
  })

  bot.command("receive", async (ctx) => {
    const user = uid(ctx)
    const code = ctx.match.replace(/\s+/g, "")
    if (!/^\d{6}$/.test(code)) return ctx.reply(HO_TEXT.receiveUsage)
    const l = d.links.get(user)
    if (!l || (l.role !== "HUMAN" && l.role !== "TRUCK")) return ctx.reply(HO_TEXT.receiversOnly)
    if (!d.codes.attempt(user)) return ctx.reply(HO_TEXT.tooMany)
    const it = d.codes.peek(code)
    if (!it) return ctx.reply(HO_TEXT.badCode)
    const receiverId = l.role === "HUMAN" ? l.agentId : l.address
    try {
      const r = await d.links.exclusive(user, () => d.agents.confirmHandover(user, { receiverId, ticket: it.ticket }))
      if (r === "busy") return ctx.reply(ID_TEXT.busy)
      d.codes.spend(code)
      return ctx.reply(HO_TEXT.done(it.lotId, formatMoney(r.releasedToSeller, it.currency)))
    } catch (e) {
      if (e instanceof AgentsError) {
        if (e.code === "TicketExpired") {
          d.codes.spend(code)
          return ctx.reply(HO_TEXT.expired)
        }
        if (e.status === 409) return ctx.reply(HO_TEXT.refused(e.code))
        if (e.status === 0) return ctx.reply(HO_TEXT.unsure(it.lotId))
      }
      return ctx.reply(explain(e, d))
    }
  })
}
