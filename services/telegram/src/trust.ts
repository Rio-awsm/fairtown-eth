import { InlineKeyboard, type Bot, type Context } from "grammy"
import { AgentsError, type AgentsClient, type LotInfo, type PhotoBody } from "./agents"
import { FileError, pickSize, type Files } from "./files"
import { explain, ID_TEXT, uid } from "./identity"
import type { Links } from "./links"
import type { Log } from "./log"
import type { Market } from "./market"

// TG 3.3: the trust paths from the chat. A buyer reports a no-show or disputes quality (with photos); the seller
// contests a no-show report (with photos). The rulings and refunds happen on chain (MarketSettlement, CRE W3 or its
// timeout); the bot only files them through the agents service, and each filing needs a button press.
export const EVIDENCE_WAIT_MS = 15 * 60_000
export const MAX_EVIDENCE = 3

type Evidence = { kind: "dispute" | "contest"; lotId: string; lotCode: string; tokenAmount?: string; buyer?: string; photos: PhotoBody[]; expiresAt: number }
type Report = { lotId: string; tokenAmount: string; expiresAt: number }

export class Trust {
  readonly evidence = new Map<number, Evidence>()
  readonly reports = new Map<number, Report>()
  constructor(private readonly now: () => number = Date.now) {}
  ev(user: number) {
    const e = this.evidence.get(user)
    if (e && e.expiresAt <= this.now()) this.evidence.delete(user)
    return this.evidence.get(user)
  }
  report(user: number) {
    const r = this.reports.get(user)
    if (r && r.expiresAt <= this.now()) this.reports.delete(user)
    return this.reports.get(user)
  }
  startEvidence(user: number, e: Omit<Evidence, "expiresAt" | "photos">) {
    this.evidence.set(user, { ...e, photos: [], expiresAt: this.now() + EVIDENCE_WAIT_MS })
  }
  startReport(user: number, r: Omit<Report, "expiresAt">) {
    this.reports.set(user, { ...r, expiresAt: this.now() + EVIDENCE_WAIT_MS })
  }
  clear(user: number): boolean {
    const a = this.evidence.delete(user)
    const b = this.reports.delete(user)
    return a || b
  }
}

export type TrustDeps = { agents: AgentsClient; links: Links; market: Market; trust: Trust; files: Files; log: Log; lotCode: () => string }

export const TRUST_TEXT = {
  usage: (cmd: string) => `Send /${cmd} followed by the lot number, for example /${cmd} 12`,
  buyersOnly: "Only a buyer signed in with /join can do that.",
  sellersOnly: "Only the seller can contest. Sign in with /link.",
  notHolder: (id: string) => `You don't hold goods from lot #${id}.`,
  notYours: (id: string) => `Lot #${id} isn't yours.`,
  noReport: (id: string) => `I haven't seen a no-show report for lot #${id}, so there's nothing to contest.`,
  confirmReport: (id: string) => `Report that the seller didn't hand over lot #${id}? The seller can contest with photos; if they don't, your share of the held money is refunded.`,
  reported: (id: string, ends: number) => `Reported. The seller can contest until block ${ends}. After that your share of the held money is refunded to you.`,
  askEvidence: (kind: Evidence["kind"], code: string) =>
    `${kind === "dispute" ? "Send 1 to 3 photos of the goods as they arrived" : "Send 1 to 3 photos that show the handover happened"}, with ${code} written on paper in view. Then tap Send.`,
  saved: (n: number) => `Photo ${n} of ${MAX_EVIDENCE} saved. Send more, or tap Send.`,
  tooMany: `That's more than ${MAX_EVIDENCE} photos; this one is skipped.`,
  needPhoto: "Send at least one photo first.",
  filed: (kind: Evidence["kind"], id: string, disputeId: string) =>
    kind === "dispute" ? `Dispute #${disputeId} opened on lot #${id}. The held money stays held until the ruling.` : `Contest filed for lot #${id} (dispute #${disputeId}). A ruling follows.`,
  cancelled: "Cancelled. Nothing was filed.",
  photoFailed: "I couldn't fetch that photo from Telegram. Please send it again.",
  unsure: (id: string) => `The market didn't answer in time, so I can't tell whether it was filed. Check /lot ${id} before trying again.`,
} as const

const evKeyboard = () => new InlineKeyboard().text("Send", "ev:send").text("Cancel", "ev:no")

export function registerTrust(bot: Bot, d: TrustDeps) {
  const lotId = (ctx: Context & { match: string }) => {
    const id = ctx.match.trim().replace(/^#/, "")
    return /^\d{1,12}$/.test(id) ? id : undefined
  }
  const buyer = (ctx: Context) => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l || l.role !== "HUMAN") return TRUST_TEXT.buyersOnly
    if (!d.links.session(user)) return ID_TEXT.ended(l)
    return l
  }
  const holding = async (ctx: Context, id: string, agentId: string): Promise<{ lot: LotInfo; tokens: string } | undefined> => {
    let lot: LotInfo
    try {
      lot = await d.agents.lot(uid(ctx), id)
    } catch (e) {
      await ctx.reply(e instanceof AgentsError && e.status === 404 ? `There's no lot #${id}.` : explain(e, d))
      return undefined
    }
    const w = lot.winners?.find((x) => x.buyer.toLowerCase() === agentId.toLowerCase() && BigInt(x.tokenAmount) > 0n)
    if (!w) {
      await ctx.reply(TRUST_TEXT.notHolder(id))
      return undefined
    }
    return { lot, tokens: w.tokenAmount }
  }

  bot.command("noshow", async (ctx) => {
    const id = lotId(ctx)
    if (!id) return ctx.reply(TRUST_TEXT.usage("noshow"))
    const l = buyer(ctx)
    if (typeof l === "string") return ctx.reply(l)
    const h = await holding(ctx, id, l.agentId)
    if (!h) return
    d.trust.startReport(uid(ctx), { lotId: id, tokenAmount: h.tokens })
    await ctx.reply(TRUST_TEXT.confirmReport(id), { reply_markup: new InlineKeyboard().text("Report no-show", `ns:ok:${id}`).text("Cancel", `ns:no:${id}`) })
  })

  bot.callbackQuery(/^ns:(ok|no):(\d{1,12})$/, async (ctx) => {
    const user = uid(ctx)
    const [, action, id] = ctx.match
    const r = d.trust.report(user)
    if (!r || r.lotId !== id) return ctx.answerCallbackQuery({ text: "This button has expired." })
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup().catch(() => undefined)
    d.trust.reports.delete(user)
    if (action === "no") return ctx.reply(TRUST_TEXT.cancelled)
    const l = buyer(ctx)
    if (typeof l === "string") return ctx.reply(l)
    try {
      const res = await d.agents.reportNoShow(user, { buyerId: l.agentId, lotId: id!, tokenAmount: r.tokenAmount })
      return ctx.reply(TRUST_TEXT.reported(id!, res.contestEnds))
    } catch (e) {
      if (e instanceof AgentsError && e.status === 0) return ctx.reply(TRUST_TEXT.unsure(id!))
      if (e instanceof AgentsError && e.status === 409) return ctx.reply(`The report didn't go through: ${e.code}.`)
      return ctx.reply(explain(e, d))
    }
  })

  bot.command("dispute", async (ctx) => {
    const id = lotId(ctx)
    if (!id) return ctx.reply(TRUST_TEXT.usage("dispute"))
    const l = buyer(ctx)
    if (typeof l === "string") return ctx.reply(l)
    const h = await holding(ctx, id, l.agentId)
    if (!h) return
    const code = d.lotCode()
    d.trust.startEvidence(uid(ctx), { kind: "dispute", lotId: id, lotCode: code, tokenAmount: h.tokens })
    await ctx.reply(TRUST_TEXT.askEvidence("dispute", code))
  })

  bot.command("contest", async (ctx) => {
    const id = lotId(ctx)
    if (!id) return ctx.reply(TRUST_TEXT.usage("contest"))
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l || l.role === "HUMAN") return ctx.reply(TRUST_TEXT.sellersOnly)
    if (!d.links.session(user)) return ctx.reply(ID_TEXT.ended(l))
    const seller = d.market.sellerOf(id)
    if (seller && seller !== l.address.toLowerCase()) return ctx.reply(TRUST_TEXT.notYours(id))
    const reporter = d.market.reporterOf(id)
    if (!reporter) return ctx.reply(TRUST_TEXT.noReport(id))
    const code = d.lotCode()
    d.trust.startEvidence(user, { kind: "contest", lotId: id, lotCode: code, buyer: reporter })
    await ctx.reply(TRUST_TEXT.askEvidence("contest", code))
  })

  bot.on("message:photo", async (ctx, next) => {
    const user = uid(ctx)
    const ev = d.trust.ev(user)
    if (!ev) return next()
    if (ev.photos.length >= MAX_EVIDENCE) return ctx.reply(TRUST_TEXT.tooMany)
    const size = pickSize(ctx.msg.photo)
    if (!size) return ctx.reply(TRUST_TEXT.photoFailed)
    try {
      const bytes = await d.files.photo(size.file_id)
      ev.photos.push({ dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`, lotCode: ev.lotCode, capturedAt: new Date(ctx.msg.date * 1000).toISOString() })
    } catch (e) {
      if (!(e instanceof FileError)) throw e
      return ctx.reply(TRUST_TEXT.photoFailed)
    }
    await ctx.reply(TRUST_TEXT.saved(ev.photos.length), { reply_markup: evKeyboard() })
  })

  bot.callbackQuery(/^ev:(send|no)$/, async (ctx) => {
    const user = uid(ctx)
    const ev = d.trust.ev(user)
    if (!ev) return ctx.answerCallbackQuery({ text: "This button has expired." })
    await ctx.answerCallbackQuery()
    if (ctx.match[1] === "no") {
      d.trust.evidence.delete(user)
      return ctx.reply(TRUST_TEXT.cancelled)
    }
    if (!ev.photos.length) return ctx.reply(TRUST_TEXT.needPhoto)
    const l = d.links.get(user)
    if (!l) return ctx.reply(TRUST_TEXT.buyersOnly)
    try {
      const r = await d.links.exclusive(user, async () => {
        if (ev.kind === "dispute") {
          if (l.role !== "HUMAN") throw new AgentsError(403, "not_buyer", "x")
          return d.agents.dispute(user, { buyerId: l.agentId, lotId: ev.lotId, tokenAmount: ev.tokenAmount!, photos: ev.photos })
        }
        const session = d.links.session(user)
        if (l.role === "HUMAN" || !session) throw new AgentsError(401, "no_session", "x")
        return d.agents.contestNoShow(user, session, { sellerId: l.sellerId, lotId: ev.lotId, buyer: ev.buyer!, photos: ev.photos })
      })
      if (r === "busy") return ctx.reply(ID_TEXT.busy)
      d.trust.evidence.delete(user)
      await ctx.editMessageReplyMarkup().catch(() => undefined)
      return ctx.reply(TRUST_TEXT.filed(ev.kind, ev.lotId, r.disputeId))
    } catch (e) {
      if (e instanceof AgentsError) {
        if (e.code === "no_session") {
          d.links.endSession(user)
          d.trust.evidence.delete(user)
          return ctx.reply(ID_TEXT.ended(l))
        }
        if (e.status === 0) {
          d.trust.evidence.delete(user)
          return ctx.reply(TRUST_TEXT.unsure(ev.lotId))
        }
        if (e.status === 409 || e.code === "bad_photos") return ctx.reply(`It didn't go through: ${e.code === "bad_photos" ? "no usable photos" : e.code}.`)
      }
      return ctx.reply(explain(e, d))
    }
  })
}
