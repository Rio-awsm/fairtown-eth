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
      ctx.addIssue({ code: "custom", message: "comma-separated numeric Telegram user ids" })
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
  })
  .superRefine((c, ctx) => {
    if (c.ADDON_TELEGRAM && !c.TELEGRAM_BOT_TOKEN)
      ctx.addIssue({ code: "custom", path: ["TELEGRAM_BOT_TOKEN"], message: "required when ADDON_TELEGRAM=1" })
  })
export type TelegramConfig = z.infer<typeof TelegramConfig>

// Errors name the variables only, never their values: the token must not reach a log or a terminal.
export function parseTelegramConfig(env: Record<string, string | undefined>): TelegramConfig {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const r = TelegramConfig.safeParse(clean)
  if (r.success) return r.data
  throw new Error(`Invalid env: ${[...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ")}`)
}
