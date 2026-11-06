import { describe, expect, it } from "vitest"
import { parseTelegramConfig } from "../src/config"
import { createLog, redact } from "../src/log"
import { FAKE_TOKEN } from "./harness"

const SERVICE = "test-only-service-token-0123456789abcdef"

describe("telegram config", () => {
  it("is off by default and needs nothing else", () => {
    const c = parseTelegramConfig({})
    expect(c.ADDON_TELEGRAM).toBe(false)
    expect(c.TELEGRAM_AGENTS_URL).toBe("http://localhost:8787")
    expect(c.TELEGRAM_RELAY_URL).toBe("ws://localhost:8788/ws")
    expect(c.TELEGRAM_ALLOWED_USERS).toBeUndefined()
  })

  it("treats empty values as unset, as .env leaves them", () => {
    const c = parseTelegramConfig({ ADDON_TELEGRAM: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_ALLOWED_USERS: "" })
    expect(c.ADDON_TELEGRAM).toBe(false)
    expect(c.TELEGRAM_BOT_TOKEN).toBeUndefined()
  })

  it("needs the bot token and the service token when switched on", () => {
    expect(() => parseTelegramConfig({ ADDON_TELEGRAM: "1", TELEGRAM_SERVICE_TOKEN: SERVICE })).toThrow(/TELEGRAM_BOT_TOKEN/)
    expect(() => parseTelegramConfig({ ADDON_TELEGRAM: "1", TELEGRAM_BOT_TOKEN: FAKE_TOKEN })).toThrow(/TELEGRAM_SERVICE_TOKEN/)
    expect(parseTelegramConfig({ ADDON_TELEGRAM: "1", TELEGRAM_BOT_TOKEN: FAKE_TOKEN, TELEGRAM_SERVICE_TOKEN: SERVICE }).ADDON_TELEGRAM).toBe(true)
  })

  it("rejects a short service token without echoing it", () => {
    const short = "short-but-secret"
    let msg = ""
    try {
      parseTelegramConfig({ TELEGRAM_SERVICE_TOKEN: short })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/TELEGRAM_SERVICE_TOKEN/)
    expect(msg).not.toContain(short)
  })

  it("rejects a malformed token without echoing it", () => {
    const bad = "not-a-token-but-still-a-secret"
    let msg = ""
    try {
      parseTelegramConfig({ ADDON_TELEGRAM: "1", TELEGRAM_BOT_TOKEN: bad })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/TELEGRAM_BOT_TOKEN/)
    expect(msg).not.toContain(bad)
  })

  it("rejects flags other than 0 and 1", () => {
    expect(() => parseTelegramConfig({ ADDON_TELEGRAM: "yes" })).toThrow(/ADDON_TELEGRAM/)
  })

  it("parses the allowlist and rejects anything that is not a numeric id", () => {
    expect([...parseTelegramConfig({ TELEGRAM_ALLOWED_USERS: " 1001, 2002 ,," }).TELEGRAM_ALLOWED_USERS!]).toEqual([1001, 2002])
    expect(() => parseTelegramConfig({ TELEGRAM_ALLOWED_USERS: "1001,@alice" })).toThrow(/TELEGRAM_ALLOWED_USERS/)
    expect(() => parseTelegramConfig({ TELEGRAM_ALLOWED_USERS: "1001 2002" })).toThrow(/TELEGRAM_ALLOWED_USERS/)
  })

  it("explains a bad allowlist without echoing the value, and never echoes a bad token", () => {
    let msg = ""
    try {
      parseTelegramConfig({ TELEGRAM_ALLOWED_USERS: "1001,@alice", TELEGRAM_BOT_TOKEN: "12345:short-secret-xyz" })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/TELEGRAM_ALLOWED_USERS \(must be numeric Telegram user ids/)
    expect(msg).toMatch(/TELEGRAM_BOT_TOKEN(,|$)/)
    expect(msg).not.toContain("@alice")
    expect(msg).not.toContain("short-secret-xyz")
  })

  it("rejects service URLs that are not URLs", () => {
    expect(() => parseTelegramConfig({ TELEGRAM_AGENTS_URL: "localhost" })).toThrow(/TELEGRAM_AGENTS_URL/)
    expect(() => parseTelegramConfig({ TELEGRAM_RELAY_URL: "http://localhost:8788/ws" })).toThrow(/TELEGRAM_RELAY_URL/)
  })
})

describe("telegram log redaction", () => {
  it("removes the configured token and anything shaped like one", () => {
    const other = "987654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12"
    expect(redact(`a ${FAKE_TOKEN} b /bot${other}/getMe`, FAKE_TOKEN)).toBe("a <token> b /bot<token>/getMe")
    expect(redact("lot 12 cleared at 7.65 EUR")).toBe("lot 12 cleared at 7.65 EUR")
  })

  it("scrubs every configured secret, including the service token", () => {
    const lines: string[] = []
    createLog([FAKE_TOKEN, SERVICE, undefined], (l) => lines.push(l)).error("x", { a: SERVICE, b: FAKE_TOKEN })
    expect(lines[0]).not.toContain(SERVICE)
    expect(lines[0]).not.toContain(FAKE_TOKEN)
  })

  it("writes one JSON line per entry with the token scrubbed from extras", () => {
    const lines: string[] = []
    const log = createLog(FAKE_TOKEN, (l) => lines.push(l))
    log.warn("call failed", { url: `https://api.telegram.org/bot${FAKE_TOKEN}/getUpdates` })
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!)
    expect(entry).toMatchObject({ level: "warn", svc: "telegram", msg: "call failed", url: "https://api.telegram.org/bot<token>/getUpdates" })
    expect(lines[0]).not.toContain(FAKE_TOKEN)
  })
})
