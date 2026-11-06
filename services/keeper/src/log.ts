import { pino, type DestinationStream, type Logger } from "pino"
import { redact, safeErrorMessage } from "./lib"

export type { Logger }

/** Field names that must never reach a log line, wherever they appear. */
const REDACT_PATHS = [
  "key",
  "privateKey",
  "keeperKey",
  "mnemonic",
  "rpcUrl",
  "url",
  "*.key",
  "*.privateKey",
  "*.keeperKey",
  "*.mnemonic",
  "*.rpcUrl",
  "*.url",
]

/**
 * pino logger for the keeper. Two layers: known secret field names are censored, and every string in a log call
 * (message and top-level string fields) has the given secret values (RPC URL, keys) replaced. Errors must go through
 * `errText`, never as raw viem errors, because viem embeds the request URL in its messages.
 */
export function createLogger(secrets: (string | undefined)[], dest?: DestinationStream, level = "info"): Logger {
  const live = secrets.filter((s): s is string => !!s && s.length >= 8)
  const scrub = (v: unknown): unknown => (typeof v === "string" ? redact(v, live) : v)
  const opts = {
    name: "keeper",
    level: process.env.LOG_LEVEL || level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    hooks: {
      logMethod(this: Logger, args: unknown[], method: (...a: unknown[]) => void) {
        const clean = args.map((a) => {
          if (a && typeof a === "object" && !Array.isArray(a)) {
            return Object.fromEntries(Object.entries(a as Record<string, unknown>).map(([k, v]) => [k, scrub(v)]))
          }
          return scrub(a)
        })
        method.apply(this, clean)
      },
    },
    serializers: { err: (e: unknown) => safeErrorMessage(e, live) },
  }
  return dest ? pino(opts, dest) : pino(opts)
}

/** One secret-free line for any error. */
export const errText = (e: unknown, secrets: (string | undefined)[]) => safeErrorMessage(e, secrets)
