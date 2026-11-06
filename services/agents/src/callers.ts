import type { FastifyInstance, FastifyRequest } from "fastify"
import { samePin } from "./handover/sessions"

// TG 0.2 (ICR-012). The Telegram bot calls on behalf of many people from one IP. With the shared service token it names
// the Telegram user, and rate limits and ownership key on that user. Without the token the user header is ignored, so
// a browser can never pose as a Telegram user.
export const BOT_TOKEN_HEADER = "x-fairtown-bot"
export const BOT_USER_HEADER = "x-telegram-user"

// Same shape as listing/routes HttpError (the server's error handler reads statusCode and code); kept here so the
// listing routes can import this module without an import cycle.
export class CallerError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type Owner = `tg:${string}`
export type Caller = { via: "bot"; owner: Owner; rateKey: string } | { via: "direct"; owner: undefined; rateKey: string }

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller | null
  }
}

const direct = (req: FastifyRequest): Caller => ({ via: "direct", owner: undefined, rateKey: `ip:${req.ip}` })

export function callerOf(req: FastifyRequest, serviceToken: string | undefined): Caller {
  const sent = req.headers[BOT_TOKEN_HEADER]
  if (sent === undefined) return direct(req)
  if (!serviceToken || typeof sent !== "string" || !samePin(sent, serviceToken)) throw new CallerError(401, "bad_service_token", "Unknown service token")
  const user = req.headers[BOT_USER_HEADER]
  if (typeof user !== "string" || !/^\d{1,15}$/.test(user)) throw new CallerError(400, "bad_request", `${BOT_USER_HEADER} must be a numeric Telegram user id`)
  return { via: "bot", owner: `tg:${user}`, rateKey: `tg:${user}` }
}

// Runs before every route, so a bad service token is refused before any body is read.
export function registerCallers(app: FastifyInstance, serviceToken: string | undefined) {
  app.decorateRequest("caller", null)
  app.addHook("onRequest", async (req) => {
    req.caller = callerOf(req, serviceToken)
  })
}

// Routes registered without the hook (unit tests) count as direct callers: they can never act on an owned resource.
export const caller = (req: FastifyRequest): Caller => req.caller ?? direct(req)

// Resources the bot creates carry their Telegram user as owner; only that user, through the bot, may act on them.
// Unowned resources (web app, personas, scripts) behave exactly as before.
export function assertOwner(owner: string | undefined, c: Caller, what: "agent" | "draft") {
  if (owner !== undefined && c.owner !== owner) throw new CallerError(403, `not_your_${what}`, `This ${what} belongs to someone else`)
}
