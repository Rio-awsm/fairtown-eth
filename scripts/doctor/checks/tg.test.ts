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
const ON: Env = { ADDON_TELEGRAM: "1", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_ALLOWED_USERS: "1001" }

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
    expect(by["tg-telegram"]).toMatchObject({ status: "warn", detail: "api.telegram.org unreachable" })
    expect(text).not.toContain(TOKEN)
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
