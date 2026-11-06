import { Bot, BotError, GrammyError, HttpError, type Context } from "grammy"
import type { UserFromGetMe } from "grammy/types"
import { randomInt } from "node:crypto"
import { registerAccount } from "./account"
import type { AgentsClient } from "./agents"
import { Bids, registerBuy } from "./buy"
import { telegramFiles, type Files } from "./files"
import { Codes, registerHandover, type QrRender } from "./handover"
import { ID_TEXT, registerIdentity, roleKeyboard, uid } from "./identity"
import { Links } from "./links"
import { redact, type Log } from "./log"
import { Market } from "./market"
import { renderQr } from "./qr"
import { registerSell, Sales } from "./sell"
import { registerTrust, Trust } from "./trust"

export type BotDeps = {
  token: string
  log: Log
  botInfo?: UserFromGetMe // tests and restarts skip getMe
  allowedUsers?: ReadonlySet<number> // demo allowlist; undefined lets anyone in
  agents: AgentsClient
  links?: Links
  market?: Market // fed by the relay (index.ts); shared with the notifier
  sales?: Sales
  bids?: Bids
  codes?: Codes
  trust?: Trust
  files?: Files // photo downloads; defaults to the Bot API file endpoint
  qr?: QrRender
  lotCode?: () => string
  auctionBlocks?: number
  now?: () => number
}

export const COMMANDS = [
  { command: "start", description: "What Fairtown can do for you" },
  { command: "market", description: "Open lots you can bid on" },
  { command: "lot", description: "One lot: price, status and steps" },
  { command: "bid", description: "Bid on a lot (buyers)" },
  { command: "sell", description: "List a lot (sellers and drivers)" },
  { command: "lots", description: "Your lots, or the lots you bid on" },
  { command: "qr", description: "Show the handover code for a lot you sold" },
  { command: "receive", description: "Confirm a handover with the seller's code" },
  { command: "noshow", description: "Report that a seller didn't hand over" },
  { command: "dispute", description: "Dispute the quality of goods, with photos" },
  { command: "contest", description: "Contest a no-show report, with photos" },
  { command: "profile", description: "Your record, payouts or budget" },
  { command: "advice", description: "Price advice for sellers" },
  { command: "link", description: "Sign in as your seller or truck account" },
  { command: "join", description: "Join as a buyer with test money" },
  { command: "whoami", description: "Who you're signed in as" },
  { command: "logout", description: "Sign out of this chat" },
  { command: "cancel", description: "Stop what you were doing" },
  { command: "help", description: "List the commands" },
] as const

export const TEXT = {
  start: [
    "Welcome to Fairtown, the open market for anything with an expiry date.",
    "",
    "From this chat you can:",
    "• Sell: list a lot with photos and a description, and follow it to paid in full",
    "• Buy: browse open lots and bid. Every bid passes the market's guardrails",
    "• Drive: offer truck capacity and confirm pickups and drop-offs",
    "",
    "Test money only, on Base Sepolia. What do you do?",
  ].join("\n"),
  help: ["Commands:", ...COMMANDS.map((c) => `/${c.command}: ${c.description}`)].join("\n"),
  unknown: "I don't know that one yet. Send /help to see what I can do.",
  notAllowed: "This Fairtown bot is invite-only for the demo.",
  // The sender's own id, shown only to them, so the operator can add it to TELEGRAM_ALLOWED_USERS.
  yourId: (id: number) => `This Fairtown bot is invite-only for the demo. Your Telegram id is ${id}: ask the operator to add it to TELEGRAM_ALLOWED_USERS.`,
  expired: "This button has expired.",
  failed: "Something went wrong on our side. Please try again.",
} as const

// Handover codes and sessions must never land in a group, so the bot works in private chats only and leaves any group.
async function privateOnly(ctx: Context, next: () => Promise<void>) {
  const chat = ctx.chat
  if (!chat) return
  if (chat.type === "private") return next()
  const joined = ctx.myChatMember && ["member", "administrator"].includes(ctx.myChatMember.new_chat_member.status)
  if (joined) await ctx.leaveChat().catch(() => undefined)
}

export function errorHandler(log: Log, token: string) {
  return async (err: BotError<Context>) => {
    const e = err.error
    const kind = e instanceof GrammyError ? "telegram" : e instanceof HttpError ? "network" : "internal"
    const detail = e instanceof GrammyError ? e.description : e instanceof Error ? e.message : String(e)
    log.error("update failed", { updateId: err.ctx.update.update_id, kind, detail: redact(detail, token).slice(0, 200) })
    if (kind === "network" || !err.ctx.chat) return // Telegram unreachable: a reply would fail too
    await err.ctx.reply(TEXT.failed).catch(() => undefined)
  }
}

export function buildBot(d: BotDeps): Bot {
  const bot = new Bot(d.token, d.botInfo ? { botInfo: d.botInfo } : {})
  bot.use(privateOnly)
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return
    if (d.allowedUsers && !d.allowedUsers.has(ctx.from.id)) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: TEXT.notAllowed })
      else if (ctx.message) await ctx.reply(TEXT.yourId(ctx.from.id))
      return
    }
    return next()
  })

  bot.command("start", (ctx) => ctx.reply(TEXT.start, { reply_markup: roleKeyboard() }))
  bot.command("help", (ctx) => ctx.reply(TEXT.help))
  const now = d.now ?? Date.now
  const links = d.links ?? new Links(now)
  const market = d.market ?? new Market()
  const sales = d.sales ?? new Sales(now)
  const bids = d.bids ?? new Bids(now)
  const trust = d.trust ?? new Trust(now)
  const codes = d.codes ?? new Codes(now)
  const files = d.files ?? telegramFiles((id) => bot.api.getFile(id), d.token)
  const lotCode = d.lotCode ?? (() => String(randomInt(1000, 10000)))
  // One flow at a time per user: starting one ends the others, so photos and numbers go to the right place.
  const endFlows = (user: number) => [sales.clear(user), bids.clear(user), trust.clear(user)].some(Boolean)

  // /cancel ends whatever is waiting: a PIN, a listing, a bid or an evidence upload.
  bot.command("cancel", async (ctx) => {
    const user = uid(ctx)
    const pin = links.cancel(user)
    const flow = endFlows(user)
    await ctx.reply(pin || flow ? ID_TEXT.cancelled : ID_TEXT.nothingToCancel)
  })
  bot.use(async (ctx, next) => {
    // Entering a command that starts a flow drops any other flow first.
    const cmd = ctx.msg?.text?.match(/^\/(sell|bid|dispute|contest|noshow)\b/)
    if (cmd && ctx.from) endFlows(ctx.from.id)
    if (ctx.callbackQuery?.data?.match(/^bid:\d+$/) && ctx.from) endFlows(ctx.from.id)
    return next()
  })
  registerIdentity(bot, { agents: d.agents, links, log: d.log, now, onLogout: endFlows })
  registerSell(bot, { agents: d.agents, links, sales, files, log: d.log, lotCode, auctionBlocks: d.auctionBlocks ?? 150 })
  registerBuy(bot, { agents: d.agents, links, market, bids, log: d.log })
  registerHandover(bot, { agents: d.agents, links, codes, qr: d.qr ?? renderQr, log: d.log })
  registerTrust(bot, { agents: d.agents, links, market, trust, files, log: d.log, lotCode })
  registerAccount(bot, { agents: d.agents, links, market, log: d.log })
  // Any press no handler above took is a leftover from an older message.
  bot.on("callback_query", (ctx) => ctx.answerCallbackQuery({ text: TEXT.expired }))
  bot.on("message", (ctx) => ctx.reply(TEXT.unknown))

  bot.catch(errorHandler(d.log, d.token))
  return bot
}
