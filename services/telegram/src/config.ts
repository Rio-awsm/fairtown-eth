import { z } from "zod"

// BotFather tokens are "<bot id>:<secret>". The check catches paste mistakes; Telegram is the real judge (doctor row tg-telegram).
export const BOT_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/

const flag = z.enum(["0", "1"]).default("0").transform((v) => v === "1")

// "123,456" -> Set {123, 456}. Telegram user ids fit in a JS number (52 bits); they are ids, never money.
const userIds = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (s === undefined || s.trim() === "") return undefined
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean)
    if (!parts.every((p) => /^\d{1,15}$/.test(p))) {
      ctx.addIssue({ code: "custom", message: "must be numeric Telegram user ids separated by commas, e.g. 123456789,987654321 (not @usernames, and commas rather than spaces between ids)" })
      return z.NEVER
    }
    return new Set(parts.map(Number))
  })

export const TelegramConfig = z
  .object({
    ADDON_TELEGRAM: flag,
    TELEGRAM_BOT_TOKEN: z.string().regex(BOT_TOKEN_RE).optional(),
    TELEGRAM_AGENTS_URL: z.url().default("http://localhost:8787"),
    TELEGRAM_RELAY_URL: z.string().regex(/^wss?:\/\/\S+$/).default("ws://localhost:8788/ws"),
    TELEGRAM_ALLOWED_USERS: userIds,
    // Same value as the agents service's (ICR-012). Without it the agents service refuses every bot call.
    TELEGRAM_SERVICE_TOKEN: z.string().min(32).optional(),
    // Auction length for bot listings, as the web app's DURATION_BLOCKS (S3 sell/model.ts).
    TELEGRAM_AUCTION_BLOCKS: z.coerce.number().int().min(10).max(100_000).default(150),
  })
  .superRefine((c, ctx) => {
    if (c.ADDON_TELEGRAM && !c.TELEGRAM_BOT_TOKEN)
      ctx.addIssue({ code: "custom", path: ["TELEGRAM_BOT_TOKEN"], message: "required when ADDON_TELEGRAM=1" })
    if (c.ADDON_TELEGRAM && !c.TELEGRAM_SERVICE_TOKEN)
      ctx.addIssue({ code: "custom", path: ["TELEGRAM_SERVICE_TOKEN"], message: "required when ADDON_TELEGRAM=1" })
  })
export type TelegramConfig = z.infer<typeof TelegramConfig>

// Errors name the variables only, never their values: the token must not reach a log or a terminal. Our own custom
// messages (which never echo input) are added as a hint; zod's built-in messages are not.
export function parseTelegramConfig(env: Record<string, string | undefined>): TelegramConfig {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const r = TelegramConfig.safeParse(clean)
  if (r.success) return r.data
  const why = new Map<string, string>()
  for (const i of r.error.issues) {
    const k = String(i.path[0])
    if (!why.has(k) || (i.code === "custom" && !why.get(k))) why.set(k, i.code === "custom" ? i.message : "")
  }
  throw new Error(`Invalid env: ${[...why].map(([k, m]) => (m ? `${k} (${m})` : k)).join(", ")}`)
}
