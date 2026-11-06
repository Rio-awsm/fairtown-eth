import type { Bot } from "grammy"
import type { Chat, Message, Update, User, UserFromGetMe } from "grammy/types"
import { buildBot, type BotDeps } from "../src/bot"
import type { Level, Log } from "../src/log"

// Not a real token: the right shape for the config check, nothing more. Every API call below is intercepted.
export const FAKE_TOKEN = "123456:TEST-ONLY-fake-token-not-real-0000000"

export const BOT_INFO = {
  id: 123456,
  is_bot: true,
  first_name: "Fairtown Test",
  username: "fairtown_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe

export const ALICE: User = { id: 1001, is_bot: false, first_name: "Alice" }
export const MALLORY: User = { id: 6666, is_bot: false, first_name: "Mallory" }

export type Call = { method: string; payload: Record<string, unknown> }
export type Entry = { level: Level; msg: string; extra?: Record<string, unknown> }

const privateChat = (u: User): Chat.PrivateChat => ({ id: u.id, type: "private", first_name: u.first_name })
const DATE = 1_793_000_000

export function harness(over: Partial<BotDeps> = {}, fail?: (call: Call) => Error | undefined) {
  const calls: Call[] = []
  const logs: Entry[] = []
  const log: Log = {
    info: (msg, extra) => logs.push({ level: "info", msg, ...(extra ? { extra } : {}) }),
    warn: (msg, extra) => logs.push({ level: "warn", msg, ...(extra ? { extra } : {}) }),
    error: (msg, extra) => logs.push({ level: "error", msg, ...(extra ? { extra } : {}) }),
  }
  const bot: Bot = buildBot({ token: FAKE_TOKEN, botInfo: BOT_INFO, log, ...over })
  bot.api.config.use(async (_prev, method, payload) => {
    const call = { method, payload: (payload ?? {}) as Record<string, unknown> }
    calls.push(call)
    const err = fail?.(call)
    if (err) throw err
    const chatId = Number(call.payload.chat_id ?? 0)
    const result =
      method === "sendMessage"
        ? ({ message_id: calls.length, date: DATE, chat: { id: chatId, type: "private", first_name: "x" }, text: String(call.payload.text) } satisfies Message.TextMessage)
        : true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result } as any
  })

  let updateId = 1
  // Updates go through bot.handleUpdate; errors are routed to the bot's own handler exactly as bot.start() does.
  const dispatch = async (u: Omit<Update, "update_id">) => {
    const update = { update_id: updateId++, ...u } as Update
    await bot.handleUpdate(update).catch((e: unknown) => bot.errorHandler(e as Parameters<Bot["errorHandler"]>[0]))
  }
  const text = (t: string, from: User = ALICE, chat: Chat = privateChat(from)) => {
    const cmd = t.match(/^\/\w+/)
    return dispatch({
      message: {
        message_id: updateId,
        date: DATE,
        chat,
        from,
        text: t,
        ...(cmd ? { entities: [{ type: "bot_command", offset: 0, length: cmd[0].length }] } : {}),
      } as NonNullable<Update["message"]>,
    })
  }
  const press = (data: string, from: User = ALICE) =>
    dispatch({
      callback_query: {
        id: `cb${updateId}`,
        from,
        chat_instance: "ci",
        data,
        message: { message_id: 1, date: DATE, chat: privateChat(from), text: "old" } as Message.TextMessage,
      },
    })
  const sent = () => calls.filter((c) => c.method === "sendMessage")
  const replies = () => sent().map((c) => String(c.payload.text))
  return { bot, calls, logs, dispatch, text, press, sent, replies, privateChat }
}
