import { loadEnv } from "@fairtown/shared/env"
import { fileURLToPath } from "node:url"
import { createAgentsClient } from "./agents"
import { buildBot, COMMANDS } from "./bot"
import { parseTelegramConfig } from "./config"
import { Links } from "./links"
import { createLog } from "./log"
import { Market } from "./market"
import { Notifier, sendQueue } from "./notify"
import { relayFeed } from "./relay"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const config = parseTelegramConfig(loadEnv(`${root}.env`).env)
const token = config.TELEGRAM_BOT_TOKEN
const log = createLog([token, config.TELEGRAM_SERVICE_TOKEN])

if (!config.ADDON_TELEGRAM || !token || !config.TELEGRAM_SERVICE_TOKEN) {
  log.info("ADDON_TELEGRAM=0: the Telegram bot is off")
  process.exit(0)
}

const agents = createAgentsClient({ baseUrl: config.TELEGRAM_AGENTS_URL, serviceToken: config.TELEGRAM_SERVICE_TOKEN })
const links = new Links()
const market = new Market()
const bot = buildBot({ token, log, agents, links, market, auctionBlocks: config.TELEGRAM_AUCTION_BLOCKS, ...(config.TELEGRAM_ALLOWED_USERS ? { allowedUsers: config.TELEGRAM_ALLOWED_USERS } : {}) })
await bot.api.setMyCommands(COMMANDS).catch((e: unknown) => log.warn("setMyCommands failed", { detail: e instanceof Error ? e.message : String(e) }))

// Relay events: update what the bot knows, then tell the users they concern.
const notifier = new Notifier({ links, market, now: Date.now, send: sendQueue({ sendMessage: (chatId, text) => bot.api.sendMessage(chatId, text), links, log }) })
const feed = relayFeed(
  { url: config.TELEGRAM_RELAY_URL, log },
  {
    onSnapshot: (s) => market.seed(s),
    onEvent: async (env) => {
      market.apply(env)
      await notifier.handle(env)
    },
  },
)
feed.start()

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    feed.stop()
    void bot.stop()
  })

// Long polling: no public URL needed. Webhook mode comes in TG 4.1.
await bot.start({
  allowed_updates: ["message", "callback_query", "my_chat_member"], // photos and voice notes arrive as "message"
  onStart: (me) => log.info("polling", { bot: `@${me.username}`, allowlist: config.TELEGRAM_ALLOWED_USERS?.size ?? "off" }),
})
