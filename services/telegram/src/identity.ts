import { InlineKeyboard, type Bot, type Context } from "grammy"
import { AgentsError, type AgentsClient, type WalkinCurrency } from "./agents"
import type { Link, Links, SellerRole } from "./links"
import type { Log } from "./log"
import { formatMoney } from "./money"

// TG 1.1: who you are. Sellers and drivers sign in as their existing account with the market PIN (the bot deletes the
// PIN message at once). Buyers join as walk-ins: a new wallet with test money, bids only through guardrails.
export type IdentityDeps = { agents: AgentsClient; links: Links; log: Log; now: () => number; onLogout?: (user: number) => void }

const SELLER_ID = /^[a-z0-9_]{1,40}$/
const SELLER_ROLES: readonly SellerRole[] = ["SELLER", "TRUCK", "STORAGE"]
// The agents service gives walk-ins a 2 h session (SESSION_MS) but doesn't return its end; a minute early is safe.
export const WALKIN_SESSION_MS = 119 * 60_000

export const ROLE_LABEL: Record<Link["role"], string> = { SELLER: "seller", TRUCK: "driver", STORAGE: "cold store", HUMAN: "buyer" }

export const roleKeyboard = () => new InlineKeyboard().text("I sell", "role:sell").text("I buy", "role:buy").row().text("I drive a truck", "role:drive")
export const currencyKeyboard = () => new InlineKeyboard().text("Play in USD", "join:USD").text("Play in EUR", "join:EUR")

const who = (l: Link) => `${l.name} (${ROLE_LABEL[l.role]}${l.role === "HUMAN" ? "" : `, id ${l.sellerId}`})`

export const ID_TEXT = {
  sellHint: "To sell, sign in as your seller account: send /link followed by your seller id, then the market PIN.\nExample: /link ingrid",
  driveHint: "Drivers sign in the same way, with their truck id.\nExample: /link lars",
  pickCurrency: "Buyers join with test money. Pick a currency:",
  linkUsage: "Send /link followed by your seller or truck id, for example /link ingrid",
  badId: "Seller ids are lowercase letters, digits and underscores, for example ingrid or coastal_catch.",
  askPin: (id: string) => `Send the market PIN for ${id} as your next message. I'll delete it straight away. (/cancel to stop)`,
  signedIn: (l: Link, minutes: number) => `Signed in as ${who(l)}. Your session lasts ${minutes} minutes.`,
  deleteYourself: "I couldn't delete your PIN message. Please delete it yourself.",
  joined: (l: Link, budget?: string) =>
    `You're in as ${l.name}, a buyer${budget && l.role === "HUMAN" ? ` with ${formatMoney(budget, l.currency)} of test money` : ""}. Your visit lasts 2 hours. See /market to bid.`,
  alreadyBuyer: (l: Link) => `You're already in as ${who(l)}. Send /logout to leave.`,
  logoutFirst: (l: Link) => `You're signed in as ${who(l)}. Send /logout first.`,
  busy: "Still working on your last request.",
  notSignedIn: "You're not signed in. What do you do?",
  whoami: (l: Link, minutes: number) => `You're ${who(l)}. Your session ends in ${minutes} minutes.`,
  ended: (l: Link) =>
    l.role === "HUMAN" ? `Your visit as ${l.name} has ended. Send /join to start a new one.` : `You were signed in as ${who(l)}, but the session ended. Send /link ${l.sellerId} to sign in again.`,
  loggedOut: "Signed out of this chat. Anything you listed or bid on stays on the market.",
  notLinked: "You're not signed in.",
  cancelled: "Cancelled.",
  nothingToCancel: "Nothing to cancel.",
} as const

export const uid = (ctx: Context) => ctx.from!.id // the bot's middleware drops updates without a sender

// Agents-service errors become plain answers. Anything else is a bug: rethrow so the bot's error handler logs it.
export function explain(e: unknown, d: Pick<IdentityDeps, "log">, sellerId?: string): string {
  if (!(e instanceof AgentsError)) throw e
  d.log.warn("agents call refused", { status: e.status, code: e.code })
  switch (e.code) {
    case "bad_pin":
      return `That PIN didn't work. Send /link ${sellerId ?? "<id>"} to try again.`
    case "rate_limited":
      return "Too many tries. Wait a few minutes, then try again."
    case "unknown_seller":
      return `There's no seller or truck account called "${sellerId}".`
    case "sessions_disabled":
      return "Seller sign-in is switched off on this market right now."
    case "walkin_full":
      return "The market is full right now. Try again later."
    case "bad_service_token":
      d.log.error("the agents service refused the bot's service token: check TELEGRAM_SERVICE_TOKEN on both")
      return "This bot isn't connected to the market properly. Please tell the organisers."
    case "timeout":
    case "unreachable":
      return "The market service isn't answering. Try again in a minute."
    default:
      return "Something went wrong on our side. Please try again."
  }
}

export function registerIdentity(bot: Bot, d: IdentityDeps) {
  bot.callbackQuery("role:sell", async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(ID_TEXT.sellHint)
  })
  bot.callbackQuery("role:drive", async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(ID_TEXT.driveHint)
  })
  bot.callbackQuery("role:buy", async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(ID_TEXT.pickCurrency, { reply_markup: currencyKeyboard() })
  })
  bot.command("join", (ctx) => ctx.reply(ID_TEXT.pickCurrency, { reply_markup: currencyKeyboard() }))

  bot.command("link", async (ctx) => {
    const user = uid(ctx)
    const id = ctx.match.trim().toLowerCase()
    if (!id) return ctx.reply(ID_TEXT.linkUsage)
    if (!SELLER_ID.test(id)) return ctx.reply(ID_TEXT.badId)
    const l = d.links.get(user)
    if (l && d.links.session(user) && (l.role === "HUMAN" || l.sellerId !== id)) return ctx.reply(ID_TEXT.logoutFirst(l))
    d.links.wait(user, { kind: "pin", sellerId: id })
    await ctx.reply(ID_TEXT.askPin(id), { reply_markup: { force_reply: true, input_field_placeholder: "PIN" } })
  })

  // The PIN: only as the next plain message after /link, only once, only within PIN_WAIT_MS.
  bot.on("message:text", async (ctx, next) => {
    const user = uid(ctx)
    if (ctx.msg.text.startsWith("/") || !d.links.isWaiting(user)) return next()
    const p = d.links.takePending(user)!
    const pin = ctx.msg.text.trim()
    const deleted = await ctx.deleteMessage().then(
      () => true,
      () => false,
    )
    let answer: string
    try {
      const r = await d.links.exclusive(user, async () => {
        const s = await d.agents.sellerSession(user, p.sellerId, pin)
        const info = await d.agents.seller(user, s.sellerId)
        const agent = await d.agents.agent(user, info.address)
        const role = SELLER_ROLES.find((x) => x === agent.role) ?? "SELLER"
        const link: Link = { role, sellerId: s.sellerId, name: info.name, address: info.address, session: { token: s.token, expiresAt: Date.parse(s.expiresAt) } }
        d.links.set(user, link)
        return link
      })
      answer = r === "busy" ? ID_TEXT.busy : ID_TEXT.signedIn(r, d.links.minutesLeft(user) ?? 0)
    } catch (e) {
      answer = explain(e, d, p.sellerId)
    }
    await ctx.reply(deleted ? answer : `${answer}\n\n${ID_TEXT.deleteYourself}`)
  })

  bot.callbackQuery(/^join:(USD|EUR)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = uid(ctx)
    const currency = ctx.match[1] as WalkinCurrency
    const l = d.links.get(user)
    if (l && d.links.session(user)) return ctx.reply(l.role === "HUMAN" ? ID_TEXT.alreadyBuyer(l) : ID_TEXT.logoutFirst(l))
    const name = (ctx.from.first_name ?? "").slice(0, 32).trim() || "Telegram buyer"
    let answer: string
    try {
      const r = await d.links.exclusive(user, async () => {
        const w = await d.agents.walkin(user, name, currency)
        const link: Link = { role: "HUMAN", agentId: w.agentId, name, currency, session: { token: w.token, expiresAt: d.now() + WALKIN_SESSION_MS } }
        d.links.set(user, link)
        // The budget is nice to show but not needed: a failed lookup must not undo a join that worked.
        const budget = await d.agents.agent(user, w.agentId).then(
          (v) => (typeof v.budget === "string" && /^\d+$/.test(v.budget) ? v.budget : undefined),
          () => undefined,
        )
        return ID_TEXT.joined(link, budget)
      })
      answer = r === "busy" ? ID_TEXT.busy : r
    } catch (e) {
      answer = explain(e, d)
    }
    await ctx.reply(answer)
  })

  bot.command("whoami", async (ctx) => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l) return ctx.reply(ID_TEXT.notSignedIn, { reply_markup: roleKeyboard() })
    const minutes = d.links.minutesLeft(user)
    await ctx.reply(minutes === undefined ? ID_TEXT.ended(l) : ID_TEXT.whoami(l, minutes))
  })

  bot.command("logout", async (ctx) => {
    const user = uid(ctx)
    const had = d.links.get(user) !== undefined
    d.links.forget(user)
    d.onLogout?.(user)
    await ctx.reply(had ? ID_TEXT.loggedOut : ID_TEXT.notLinked)
  })

}
