import type { Check, Env, Result } from "../core"

// Telegram bot (TG stream, ADDON_TELEGRAM). Off by default; every row is ok and skipped while it is off.
const TIMEOUT_MS = 3000
const TELEGRAM_TIMEOUT_MS = 8000 // a cold first TLS connection to api.telegram.org can take a few seconds
const BOT_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/

// Why a fetch failed, from the error's name and code only: fetch messages can quote the URL, and this URL holds the token.
export function whyFailed(e: unknown, timeoutMs: number): string {
  const err = e as { name?: string; cause?: { code?: unknown } }
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `timed out after ${timeoutMs / 1000}s`
  const code = err?.cause?.code
  return typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? `network error ${code}` : "network error"
}

export type TgDeps = { fetch: typeof fetch }

const on = (env: Env) => env.ADDON_TELEGRAM === "1"
const OFF: Result = { status: "ok", detail: "ADDON_TELEGRAM=0 (bot off)" }

function config(env: Env): Result {
  if (env.ADDON_TELEGRAM !== undefined && !["0", "1"].includes(env.ADDON_TELEGRAM)) return { status: "fail", detail: "ADDON_TELEGRAM must be 0 or 1" }
  // The agents service refuses to start with a short one, bot or no bot (ICR-012).
  const service = env.TELEGRAM_SERVICE_TOKEN
  if (service && service.length < 32) return { status: "fail", detail: "TELEGRAM_SERVICE_TOKEN must be at least 32 characters (openssl rand -hex 24)" }
  if (!on(env)) return OFF
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token) return { status: "fail", detail: "ADDON_TELEGRAM=1 but TELEGRAM_BOT_TOKEN is empty (create a bot with @BotFather)" }
  if (!BOT_TOKEN_RE.test(token)) return { status: "fail", detail: "TELEGRAM_BOT_TOKEN doesn't look like a BotFather token (<id>:<secret>)" }
  const list = env.TELEGRAM_ALLOWED_USERS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
  if (!list.every((s) => /^\d{1,15}$/.test(s))) return { status: "fail", detail: "TELEGRAM_ALLOWED_USERS must be numeric Telegram user ids, comma separated" }
  const warnings = [
    ...(service ? [] : ["TELEGRAM_SERVICE_TOKEN empty: the agents service refuses every bot call (openssl rand -hex 24)"]),
    ...(list.length ? [] : ["no TELEGRAM_ALLOWED_USERS: anyone who finds the bot can use it"]),
  ]
  return warnings.length
    ? { status: "warn", detail: `token set; ${warnings.join("; ")}` }
    : { status: "ok", detail: `token set, service token set, allowlist of ${list.length}` }
}

// getMe proves the token works. The URL holds the token, so neither it nor a fetch error message is ever printed.
async function telegram(env: Env, deps: TgDeps): Promise<Result> {
  if (!on(env)) return OFF
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token || !BOT_TOKEN_RE.test(token)) return { status: "fail", detail: "no usable token (see tg-config)" }
  try {
    const res = await deps.fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string } }
    if (res.status === 401 || res.status === 404) return { status: "fail", detail: `Telegram rejected the token (HTTP ${res.status}); get a fresh one from @BotFather` }
    if (!res.ok || !body.ok || !body.result?.username) return { status: "fail", detail: `getMe returned HTTP ${res.status}` }
    return { status: "ok", detail: `token works for @${body.result.username}` }
  } catch (e) {
    return { status: "warn", detail: `api.telegram.org unreachable (${whyFailed(e, TELEGRAM_TIMEOUT_MS)})` }
  }
}

const relayHealth = (ws: string) => ws.replace(/^ws/, "http").replace(/\/ws\/?$/, "").replace(/\/+$/, "") + "/health"

// The bot is a client of the agents service and the relay; not running yet is a warning, not a failure.
async function services(env: Env, deps: TgDeps): Promise<Result> {
  if (!on(env)) return OFF
  const agents = `${(env.TELEGRAM_AGENTS_URL ?? "http://localhost:8787").replace(/\/+$/, "")}/api/health`
  const relay = relayHealth(env.TELEGRAM_RELAY_URL ?? "ws://localhost:8788/ws")
  const down: string[] = []
  for (const [name, url] of [["agents", agents], ["relay", relay]] as const) {
    try {
      const res = await deps.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) down.push(`${name} HTTP ${res.status}`)
    } catch {
      down.push(`${name} unreachable`)
    }
  }
  return down.length
    ? { status: "warn", detail: `${down.join(", ")} (start them with pnpm dev:all)` }
    : { status: "ok", detail: "agents and relay reachable" }
}

export const tgChecks = (deps: TgDeps = { fetch }): Check[] => [
  { id: "tg-config", owner: "TG", title: "Telegram bot env", run: ({ env }) => config(env) },
  { id: "tg-telegram", owner: "TG", title: "Telegram token", run: ({ env }) => telegram(env, deps) },
  { id: "tg-services", owner: "TG", title: "Agents and relay for the bot", run: ({ env }) => services(env, deps) },
]
