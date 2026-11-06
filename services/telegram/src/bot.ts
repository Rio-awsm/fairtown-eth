import { Bot, BotError, GrammyError, HttpError, type Context } from "grammy"
import type { UserFromGetMe } from "grammy/types"
import { redact, type Log } from "./log"

export type BotDeps = {
  token: string
  log: Log
  botInfo?: UserFromGetMe // tests and restarts skip getMe
  allowedUsers?: ReadonlySet<number> // demo allowlist; undefined lets anyone in
}

export const COMMANDS = [
  { command: "start", description: "What Fairtown can do for you" },
  { command: "help", description: "List the commands" },
] as const

export const TEXT = {
  start: [
    "Welcome to Fairtown, the open market for anything with an expiry date.",
    "",
    "From this chat you'll be able to:",
    "• Sell: list a lot by text, voice or photos and follow it to paid in full",
    "• Buy: browse open lots and bid. Every bid passes the market's guardrails",
    "• Drive: offer truck capacity and confirm pickups and drop-offs",
    "",
    "Accounts and trading arrive in the next update. Send /help for the commands.",
    "Test money only, on Base Sepolia.",
  ].join("\n"),
  help: ["Commands:", ...COMMANDS.map((c) => `/${c.command}: ${c.description}`)].join("\n"),
  unknown: "I don't know that one yet. Send /help to see what I can do.",
  notAllowed: "This Fairtown bot is invite-only for the demo.",
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
      else if (ctx.message) await ctx.reply(TEXT.notAllowed)
      return
    }
    return next()
  })

  bot.command("start", (ctx) => ctx.reply(TEXT.start))
  bot.command("help", (ctx) => ctx.reply(TEXT.help))
  // No buttons exist yet; any press is a leftover from an older message.
  bot.on("callback_query", (ctx) => ctx.answerCallbackQuery({ text: TEXT.expired }))
  bot.on("message", (ctx) => ctx.reply(TEXT.unknown))

  bot.catch(errorHandler(d.log, d.token))
  return bot
}
