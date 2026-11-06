export type Level = "info" | "warn" | "error"
export type Log = Record<Level, (msg: string, extra?: Record<string, unknown>) => void>

// Bot API URLs carry the token ("/bot<id>:<secret>/"), so any string headed for a log goes through this first.
const TOKEN_ANYWHERE = /\d{5,15}:[A-Za-z0-9_-]{30,}/g

export function redact(s: string, secrets?: string | ReadonlyArray<string | undefined>): string {
  let out = s
  for (const x of typeof secrets === "string" ? [secrets] : (secrets ?? [])) if (x) out = out.split(x).join("<token>")
  return out.replace(TOKEN_ANYWHERE, "<token>")
}

// One JSON line per entry. Message text from users is never passed in: PINs and handover codes arrive by chat later.
export function createLog(secrets: string | ReadonlyArray<string | undefined> | undefined, write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Log {
  const emit = (level: Level) => (msg: string, extra?: Record<string, unknown>) =>
    write(redact(JSON.stringify({ level, svc: "telegram", time: new Date().toISOString(), msg, ...extra }), secrets))
  return { info: emit("info"), warn: emit("warn"), error: emit("error") }
}
