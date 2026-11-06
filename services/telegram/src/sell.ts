import { splitPayout, toBase } from "@fairtown/shared/units"
import { InlineKeyboard, type Bot, type Context } from "grammy"
import { AgentsError, type AgentsClient, type DraftPhoto, type DraftView } from "./agents"
import { FileError, pickSize, type Files } from "./files"
import { explain, ID_TEXT, uid } from "./identity"
import type { Links } from "./links"
import type { Log } from "./log"
import { formatBase, formatMoney } from "./money"

// TG 1.2: list a lot from the chat. A signed-in seller or driver just sends a photo with the description as its
// caption (an album of up to 3 works too, and /sell lets them start with text). The agents service drafts, grades and
// suggests a floor; the seller taps List, changes the floor or cancels. Nothing reaches the chain until "List" is
// pressed, and the lot is created by the agents service. A lot code is still attached to the photos for the agents
// service's DraftRequest, but sellers are no longer asked to show it, so its "not visible" check is not shown.
export const SELL_WAIT_MS = 15 * 60_000 // a listing in progress lapses after 15 quiet minutes; a lapsed draft is never listed
export const MAX_PHOTOS = 3 // DraftRequest.photos max
export const MAX_TEXT = 500
export const FEE_BPS = 100n // D-09, the same 1% the web app previews (S3 sell/model.ts FEE_BPS)
export const MIN_FLOOR = 1_000n // 0.001 per unit, the agents service's floor_too_low limit
export const ALBUM_WAIT_MS = 2_000 // Telegram sends an album as separate messages: draft once they stop arriving
const CODE_DEFECT = "Lot code not visible"

type Base = { sellerId: string; lotCode: string; expiresAt: number }
export type SellState =
  | (Base & { step: "collect"; photos: DraftPhoto[]; caption?: string; group?: string; seq?: number })
  | (Base & { step: "draft" | "floor"; draft: DraftView; floor: bigint; custom: boolean }) // custom: the seller typed the floor
type NewState = SellState extends infer S ? (S extends SellState ? Omit<S, "expiresAt"> : never) : never

export class Sales {
  private readonly m = new Map<number, SellState>()
  constructor(private readonly now: () => number = Date.now) {}
  get(user: number): SellState | undefined {
    const s = this.m.get(user)
    if (s && s.expiresAt <= this.now()) {
      this.m.delete(user)
      return undefined
    }
    return s
  }
  set(user: number, s: NewState): SellState {
    const full = { ...s, expiresAt: this.now() + SELL_WAIT_MS } as SellState
    this.m.set(user, full)
    return full
  }
  touch(user: number) {
    const s = this.m.get(user)
    if (s) s.expiresAt = this.now() + SELL_WAIT_MS
  }
  clear(user: number): boolean {
    return this.m.delete(user)
  }
}

export type SellDeps = {
  agents: AgentsClient
  links: Links
  sales: Sales
  files: Files
  log: Log
  lotCode: () => string
  auctionBlocks: number
  inOtherFlow: (user: number) => boolean // a bid or evidence upload in progress: its photos aren't a new listing
  later?: (f: () => void, ms: number) => void
}

const pretty = (id: string) =>
  id
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ")
const TIER = { new: "new seller", proven: "proven seller", truck: "truck" } as const
const qtyText = (d: DraftView) => `${formatBase(BigInt(d.qty) * 1_000_000n)} ${d.unit} ${d.commodity}`
const perUnit = (d: DraftView) => `${d.currency} per ${d.unit}`

export const SELL_TEXT = {
  signInFirst: "Sign in as your seller account first: /link <your seller id>, for example /link ingrid",
  buyersCant: "You're signed in as a buyer. To sell, send /logout, then /link your seller account.",
  howTo: "To sell, send a photo of your lot with a description as the caption, for example: 600 kg cod, Bergen",
  instructions: "Send a photo of your lot with a description as the caption, for example: 600 kg cod, Bergen\nNo photo? Just send the description. (/cancel to stop)",
  restart: "Starting a new listing. The earlier draft wasn't listed.",
  photoSaved: "Photo saved. Now send a description, for example: 600 kg cod, Bergen",
  tooMany: `That's more than ${MAX_PHOTOS} photos; this one is skipped.`,
  photoTooBig: "That photo is too large. Please send a smaller one.",
  photoFailed: "I couldn't fetch that photo from Telegram. Please send it again.",
  noVoice: "Voice notes come in a later update. Please type the description.",
  tooLong: `Please keep the description under ${MAX_TEXT} characters.`,
  describeFirst: "Describe the lot first, in one message.",
  unreadable: (why: string) => `${why}\nYour photos are kept. Send the description again.`,
  useButtons: "Use the buttons on the draft, or send /cancel.",
  askFloor: (d: DraftView, floor: bigint) => `Send your floor in ${perUnit(d)}, for example ${floor > MIN_FLOOR ? formatBase(floor) : "7.20"}. (/cancel to stop)`,
  badFloor: (d: DraftView) => `That isn't a price. Send a number in ${perUnit(d)}, like 7.20.`,
  floorTooLow: "The floor must be at least 0.001 per unit.",
  cancelled: "Cancelled. Nothing was listed.",
  gone: "This draft can't be listed from here any more. Send a new photo with a description to start again.",
  unsure: "The market didn't answer in time, so I can't tell whether the lot was listed. I've closed this draft so it can't be listed twice. If it doesn't appear in town in a minute, send the photo and description again.",
  listed: (d: DraftView, floor: bigint, lotId: string, blocks: number, tx: string) =>
    [`Listed: lot #${lotId}, ${qtyText(d)} at a floor of ${formatMoney(floor, perUnit(d))}.`, `The auction runs for ${blocks} blocks. Test money only.`, `Transaction: ${tx}`].join("\n"),
} as const

// With no reference price and no recent clears the agents service falls back to the 0.001 minimum. That is a
// placeholder, not advice: the seller must set a floor before "List" appears.
export const needsFloor = (d: DraftView, custom: boolean) => !custom && BigInt(d.suggestedFloorPerUnit) <= MIN_FLOOR

// What the seller gets if the lot sells exactly at the floor: the honest minimum, in bigint base units throughout.
export function payoutAtFloor(d: DraftView, floor: bigint) {
  return splitPayout(floor * BigInt(d.qty), FEE_BPS, BigInt(d.payoutPreview.advanceBps))
}

export function draftCard(d: DraftView, floor: bigint, sellerName: string, custom = false): string {
  const suggested = !custom
  const { advance, held } = payoutAtFloor(d, floor)
  if (needsFloor(d, custom))
    return [
      `Draft for ${sellerName}`,
      `${qtyText(d)}, ${pretty(d.place)} (${pretty(d.market)})`,
      `Grade: ${d.grade.replace(/_/g, " ")}, ${Math.round(d.gradeReport.confidence * 100)}% sure`,
      ...(checks(d).length ? [`Checks: ${checks(d).join("; ")}`] : []),
      `Floor: not set. There's no reference price or recent sale for this yet, so set your own floor in ${perUnit(d)}.`,
      "Test money only.",
    ].join("\n")
  return [
    `Draft for ${sellerName}`,
    `${qtyText(d)}, ${pretty(d.place)} (${pretty(d.market)})`,
    `Grade: ${d.grade.replace(/_/g, " ")}, ${Math.round(d.gradeReport.confidence * 100)}% sure`,
    ...(checks(d).length ? [`Checks: ${checks(d).join("; ")}`] : []),
    ...(d.reference ? [`Reference: ${formatMoney(d.reference.perUnit, d.reference.currency)} per ${d.unit} (${d.reference.source}, ${d.reference.date})`] : []),
    `Floor: ${formatMoney(floor, perUnit(d))} ${suggested ? "(suggested)" : "(your price)"}`,
    ...(suggested && d.floorBasis?.length ? [`Why: ${d.floorBasis.slice(0, 2).join("; ")}`] : []),
    `If it sells at the floor, after the 1% fee: at least ${formatMoney(advance, d.currency)} at the sale and ${formatMoney(held, d.currency)} at handover (${TIER[d.payoutPreview.tier]}, ${d.payoutPreview.advanceBps / 100}% at the sale).`,
    "Test money only.",
  ].join("\n")
}

const checks = (d: DraftView) => d.gradeReport.defects.filter((x) => x !== CODE_DEFECT)

const cardKeyboard = (d: DraftView, floor: bigint, custom: boolean) =>
  needsFloor(d, custom)
    ? new InlineKeyboard().text("Set floor", `sell:floor:${d.draftId}`).text("Cancel", `sell:no:${d.draftId}`)
    : new InlineKeyboard().text(`List at ${formatBase(floor)}`, `sell:ok:${d.draftId}`).row().text("Change floor", `sell:floor:${d.draftId}`).text("Cancel", `sell:no:${d.draftId}`)

export function registerSell(bot: Bot, d: SellDeps) {
  const later = d.later ?? ((f: () => void, ms: number) => void setTimeout(f, ms).unref())
  const sendCard = (ctx: Context, user: number, s: Extract<SellState, { step: "draft" | "floor" }>) => {
    const l = d.links.get(user)
    return ctx.reply(draftCard(s.draft, s.floor, l?.name ?? s.sellerId, s.custom), { reply_markup: cardKeyboard(s.draft, s.floor, s.custom) })
  }

  async function makeDraft(ctx: Context, user: number, text: string) {
    const s = d.sales.get(user)
    if (!s || s.step !== "collect") return
    if (!text) return ctx.reply(SELL_TEXT.describeFirst)
    if (text.length > MAX_TEXT) return ctx.reply(SELL_TEXT.tooLong)
    const l = d.links.get(user)
    const session = d.links.session(user)
    if (!l || !session) {
      d.sales.clear(user)
      return ctx.reply(l ? ID_TEXT.ended(l) : SELL_TEXT.signInFirst)
    }
    await ctx.replyWithChatAction("typing").catch(() => undefined)
    try {
      const draft = await d.links.exclusive(user, () => d.agents.draft(user, session, { sellerId: s.sellerId, text, photos: s.photos }))
      if (draft === "busy") return ctx.reply(ID_TEXT.busy)
      const next = d.sales.set(user, { step: "draft", sellerId: s.sellerId, lotCode: s.lotCode, draft, floor: BigInt(draft.suggestedFloorPerUnit), custom: false })
      return sendCard(ctx, user, next as Extract<SellState, { step: "draft" }>)
    } catch (e) {
      if (e instanceof AgentsError && e.code === "unreadable") return ctx.reply(SELL_TEXT.unreadable(e.message))
      if (e instanceof AgentsError && (e.code === "no_session" || e.code === "wrong_seller")) {
        d.links.endSession(user)
        d.sales.clear(user)
        return ctx.reply(ID_TEXT.ended(l))
      }
      return ctx.reply(explain(e, d))
    }
  }

  bot.command("sell", async (ctx) => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l) return ctx.reply(SELL_TEXT.signInFirst)
    if (l.role === "HUMAN") return ctx.reply(SELL_TEXT.buyersCant)
    if (!d.links.session(user)) return ctx.reply(ID_TEXT.ended(l))
    d.sales.set(user, { step: "collect", sellerId: l.sellerId, lotCode: d.lotCode(), photos: [] })
    await ctx.reply(SELL_TEXT.instructions)
  })

  // A photo from a signed-in seller or driver starts a listing by itself; anyone else's photo goes to the next handler.
  // A photo while a draft card is open starts a fresh listing: the old card's buttons are bound to its draft and expire.
  async function startFromPhoto(ctx: Context, user: number) {
    const cur = d.sales.get(user)
    if (cur?.step === "collect") return cur
    if (!cur && d.inOtherFlow(user)) return undefined
    const l = d.links.get(user)
    if (!l || l.role === "HUMAN" || !d.links.session(user)) return cur ? "stale" : undefined
    const s = d.sales.set(user, { step: "collect", sellerId: l.sellerId, lotCode: d.lotCode(), photos: [] })
    if (cur) await ctx.reply(SELL_TEXT.restart)
    return s as Extract<SellState, { step: "collect" }>
  }

  bot.on("message:photo", async (ctx, next) => {
    const user = uid(ctx)
    const s = await startFromPhoto(ctx, user)
    if (s === "stale") {
      const l = d.links.get(user)
      d.sales.clear(user)
      return ctx.reply(l ? ID_TEXT.ended(l) : SELL_TEXT.signInFirst)
    }
    if (!s) return next()
    if (s.photos.length >= MAX_PHOTOS) return ctx.reply(SELL_TEXT.tooMany)
    const size = pickSize(ctx.msg.photo)
    if (!size) return ctx.reply(SELL_TEXT.photoTooBig)
    let bytes: Buffer
    try {
      bytes = await d.files.photo(size.file_id)
    } catch (e) {
      if (!(e instanceof FileError)) throw e
      d.log.warn("photo download failed", { code: e.code })
      return ctx.reply(e.code === "too_big" ? SELL_TEXT.photoTooBig : SELL_TEXT.photoFailed)
    }
    // Telegram photos are JPEG. capturedAt is when Telegram received it: the bot can't see the camera's own time.
    s.photos.push({ dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`, lotCode: s.lotCode, capturedAt: new Date(ctx.msg.date * 1000).toISOString() })
    d.sales.touch(user)
    const caption = ctx.msg.caption?.trim()
    const group = ctx.msg.media_group_id
    if (caption && !group) return makeDraft(ctx, user, caption)
    if (!group) return ctx.reply(SELL_TEXT.photoSaved)
    // An album: wait until its photos stop arriving, then draft from its caption (or ask for one), answering once.
    if (caption) s.caption = caption
    s.group = group
    const seq = (s.seq = (s.seq ?? 0) + 1)
    later(() => {
      const now = d.sales.get(user)
      if (now !== s || s.seq !== seq) return // a later photo took over, or the listing moved on
      const run = s.caption ? makeDraft(ctx, user, s.caption) : ctx.reply(SELL_TEXT.photoSaved)
      Promise.resolve(run).catch((e: unknown) => d.log.error("album draft failed", { detail: e instanceof Error ? e.message : String(e) }))
    }, ALBUM_WAIT_MS)
  })

  bot.on(["message:voice", "message:audio"], async (ctx, next) => {
    if (!d.sales.get(uid(ctx))) return next()
    await ctx.reply(SELL_TEXT.noVoice)
  })

  bot.on("message:text", async (ctx, next) => {
    const user = uid(ctx)
    const s = d.sales.get(user)
    if (!s || ctx.msg.text.startsWith("/")) return next()
    const text = ctx.msg.text.trim()
    if (s.step === "collect") return makeDraft(ctx, user, text)
    if (s.step === "draft") return ctx.reply(SELL_TEXT.useButtons)
    // step "floor": "7.20" or "7,20"; parsed straight to bigint base units.
    const v = text.replace(/^(\d+),(\d{1,6})$/, "$1.$2")
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(v)) return ctx.reply(SELL_TEXT.badFloor(s.draft))
    const floor = toBase(v)
    if (floor < MIN_FLOOR) return ctx.reply(SELL_TEXT.floorTooLow)
    const next2 = d.sales.set(user, { step: "draft", sellerId: s.sellerId, lotCode: s.lotCode, draft: s.draft, floor, custom: true })
    return sendCard(ctx, user, next2 as Extract<SellState, { step: "draft" }>)
  })

  // Buttons on a draft card act only on the draft they were sent with, and only while it is the current one.
  bot.callbackQuery(/^sell:(ok|floor|no):(d_[a-z0-9]{1,24})$/, async (ctx) => {
    const user = uid(ctx)
    const [, action, draftId] = ctx.match
    const s = d.sales.get(user)
    if (!s || s.step === "collect" || s.draft.draftId !== draftId) return ctx.answerCallbackQuery({ text: "This button has expired." })
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup().catch(() => undefined) // one press per card
    if (action === "no") {
      d.sales.clear(user)
      return ctx.reply(SELL_TEXT.cancelled)
    }
    // A forged or old "List" for a draft with no real floor yet: never list at the 0.001 placeholder.
    if (action === "ok" && needsFloor(s.draft, s.custom)) return sendCard(ctx, user, s as Extract<SellState, { step: "draft" }>)
    if (action === "floor") {
      d.sales.set(user, { step: "floor", sellerId: s.sellerId, lotCode: s.lotCode, draft: s.draft, floor: s.floor, custom: s.custom })
      return ctx.reply(SELL_TEXT.askFloor(s.draft, s.floor))
    }
    try {
      const r = await d.links.exclusive(user, () => d.agents.confirm(user, { draftId: s.draft.draftId, floorPerUnit: s.floor.toString(), durationBlocks: d.auctionBlocks }))
      if (r === "busy") return ctx.reply(ID_TEXT.busy)
      d.sales.clear(user)
      return ctx.reply(SELL_TEXT.listed(s.draft, s.floor, r.lotId, d.auctionBlocks, r.tx))
    } catch (e) {
      if (e instanceof AgentsError && e.code === "already_listed") {
        d.sales.clear(user)
        return ctx.reply(e.message)
      }
      if (e instanceof AgentsError && ["not_your_draft", "unknown_draft"].includes(e.code)) {
        d.sales.clear(user)
        return ctx.reply(SELL_TEXT.gone)
      }
      // No answer: the lot may exist on chain already. Close the draft so a second press can't list it twice.
      if (e instanceof AgentsError && e.status === 0) {
        d.sales.clear(user)
        d.log.warn("confirm got no answer; draft closed", { code: e.code })
        return ctx.reply(SELL_TEXT.unsure)
      }
      // A refusal (e.g. a chain revert): nothing was listed and the draft is unchanged, so offer the card again.
      await ctx.reply(explain(e, d))
      return sendCard(ctx, user, s as Extract<SellState, { step: "draft" }>)
    }
  })
}
