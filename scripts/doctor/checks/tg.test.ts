import { describe, expect, it } from "vitest"
import { formatRows, runChecks, type Env } from "../core"
import { tgChecks, type TgDeps } from "./tg"

// Not a real token, right shape only. All fetches are faked.
const TOKEN = "123456:TEST-ONLY-fake-token-not-real-0000000"
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const getMeOk = () => json({ ok: true, result: { username: "fairtown_test_bot" } })

const run = async (env: Env, fetch: TgDeps["fetch"] = async () => getMeOk()) => {
  const rows = await runChecks(tgChecks({ fetch }), { env, envFileFound: true, versions: { node: "22.18.0", pnpm: "9.15.9" } })
  return { rows, by: Object.fromEntries(rows.map((r) => [r.id, r])), text: formatRows(rows) }
}
const SERVICE = "test-only-service-token-0123456789abcdef"
const ON: Env = { ADDON_TELEGRAM: "1", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_ALLOWED_USERS: "1001", TELEGRAM_SERVICE_TOKEN: SERVICE }

describe("TG doctor rows", () => {
  it("are ok and make no calls while the bot is off", async () => {
    let calls = 0
    const { rows } = await run({}, async () => {
      calls++
      return getMeOk()
    })
    expect(rows.map((r) => [r.id, r.status, r.owner])).toEqual([
      ["tg-config", "ok", "TG"],
      ["tg-telegram", "ok", "TG"],
      ["tg-services", "ok", "TG"],
    ])
    expect(calls).toBe(0)
  })

  it("are all ok when the token works and services answer, and never print the token", async () => {
    const urls: string[] = []
    const { by, text } = await run(ON, async (u) => {
      urls.push(String(u))
      return getMeOk()
    })
    expect(by["tg-config"]!.status).toBe("ok")
    expect(by["tg-telegram"]).toMatchObject({ status: "ok", detail: "token works for @fairtown_test_bot" })
    expect(by["tg-services"]!.status).toBe("ok")
    expect(urls).toEqual([`https://api.telegram.org/bot${TOKEN}/getMe`, "http://localhost:8787/api/health", "http://localhost:8788/health"])
    expect(text).not.toContain(TOKEN)
  })

  it("fails when switched on without a token or with a malformed one", async () => {
    expect((await run({ ADDON_TELEGRAM: "1" })).by["tg-config"]!.status).toBe("fail")
    const bad = await run({ ADDON_TELEGRAM: "1", TELEGRAM_BOT_TOKEN: "secret-but-wrong" })
    expect(bad.by["tg-config"]!.status).toBe("fail")
    expect(bad.by["tg-telegram"]!.status).toBe("fail")
    expect(bad.text).not.toContain("secret-but-wrong")
  })

  it("fails on a bad flag or allowlist, and warns when there is no allowlist", async () => {
    expect((await run({ ADDON_TELEGRAM: "yes" })).by["tg-config"]!.status).toBe("fail")
    expect((await run({ ...ON, TELEGRAM_ALLOWED_USERS: "1001,@bob" })).by["tg-config"]!.status).toBe("fail")
    expect((await run({ ...ON, TELEGRAM_ALLOWED_USERS: undefined })).by["tg-config"]!.status).toBe("warn")
  })

  it("checks the service token shared with the agents service, without printing it", async () => {
    const short = await run({ TELEGRAM_SERVICE_TOKEN: "too-short-secret" })
    expect(short.by["tg-config"]!.status).toBe("fail") // agents would not start, even with the bot off
    expect(short.text).not.toContain("too-short-secret")
    expect((await run({ ...ON, TELEGRAM_SERVICE_TOKEN: undefined })).by["tg-config"]).toMatchObject({ status: "warn" })
    expect((await run({ ...ON, TELEGRAM_SERVICE_TOKEN: undefined })).by["tg-config"]!.detail).toMatch(/TELEGRAM_SERVICE_TOKEN/)
    expect((await run(ON)).by["tg-config"]!.status).toBe("ok")
  })

  it("fails when Telegram rejects the token", async () => {
    const { by } = await run(ON, async (u) => (String(u).includes("getMe") ? json({ ok: false, error_code: 401, description: "Unauthorized" }, 401) : json({})))
    expect(by["tg-telegram"]!.status).toBe("fail")
    expect(by["tg-telegram"]!.detail).toMatch(/rejected/)
  })

  it("warns, without the fetch error text, when Telegram is unreachable", async () => {
    const { by, text } = await run(ON, async (u) => {
      if (String(u).includes("getMe")) throw new Error(`fetch failed for ${String(u)}`)
      return json({})
    })
    expect(by["tg-telegram"]).toMatchObject({ status: "warn", detail: "api.telegram.org unreachable (network error)" })
    expect(text).not.toContain(TOKEN)
  })

  it("says whether Telegram timed out or refused, from the error code only", async () => {
    const timeout = Object.assign(new Error(`aborted ${TOKEN}`), { name: "TimeoutError" })
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", message: `connect https://api.telegram.org/bot${TOKEN}` } })
    const odd = Object.assign(new TypeError("fetch failed"), { cause: { code: `bad ${TOKEN}` } })
    for (const [err, want] of [
      [timeout, "api.telegram.org unreachable (timed out after 8s)"],
      [refused, "api.telegram.org unreachable (network error ECONNREFUSED)"],
      [odd, "api.telegram.org unreachable (network error)"],
    ] as const) {
      const { by, text } = await run(ON, async (u) => {
        if (String(u).includes("getMe")) throw err
        return json({})
      })
      expect(by["tg-telegram"]).toMatchObject({ status: "warn", detail: want })
      expect(text).not.toContain(TOKEN)
    }
  })

  it("warns when the agents service or relay is down, using custom URLs", async () => {
    const urls: string[] = []
    const { by } = await run({ ...ON, TELEGRAM_AGENTS_URL: "http://10.0.0.5:9000/", TELEGRAM_RELAY_URL: "wss://relay.example/ws" }, async (u) => {
      urls.push(String(u))
      if (String(u).includes("getMe")) return getMeOk()
      if (String(u).includes("relay")) throw new Error("refused")
      return json({}, 503)
    })
    expect(urls.slice(1)).toEqual(["http://10.0.0.5:9000/api/health", "https://relay.example/health"])
    expect(by["tg-services"]).toMatchObject({ status: "warn" })
    expect(by["tg-services"]!.detail).toContain("agents HTTP 503")
    expect(by["tg-services"]!.detail).toContain("relay unreachable")
  })
})
