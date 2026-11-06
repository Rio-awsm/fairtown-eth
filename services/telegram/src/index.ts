import { loadEnv } from "@fairtown/shared/env"
import { fileURLToPath } from "node:url"
import { buildBot, COMMANDS } from "./bot"
import { parseTelegramConfig } from "./config"
import { createLog } from "./log"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const config = parseTelegramConfig(loadEnv(`${root}.env`).env)
const token = config.TELEGRAM_BOT_TOKEN
const log = createLog(token)

if (!config.ADDON_TELEGRAM || !token) {
  log.info("ADDON_TELEGRAM=0: the Telegram bot is off")
  process.exit(0)
}

const bot = buildBot({ token, log, ...(config.TELEGRAM_ALLOWED_USERS ? { allowedUsers: config.TELEGRAM_ALLOWED_USERS } : {}) })
await bot.api.setMyCommands(COMMANDS).catch((e: unknown) => log.warn("setMyCommands failed", { detail: e instanceof Error ? e.message : String(e) }))

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void bot.stop())

// Long polling: no public URL needed. Webhook mode comes in TG 4.1.
await bot.start({
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  onStart: (me) => log.info("polling", { bot: `@${me.username}`, allowlist: config.TELEGRAM_ALLOWED_USERS?.size ?? "off" }),
})
