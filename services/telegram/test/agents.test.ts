import { describe, expect, it } from "vitest"
import { AgentsError, BOT_TOKEN_HEADER, BOT_USER_HEADER, createAgentsClient } from "../src/agents"
import { formatBase, formatMoney } from "../src/money"

// Test-only values; every fetch is faked.
const SERVICE = "test-only-service-token-0123456789abcdef"
const ADDR = "0x00000000000000000000000000000000000000a1"
type Seen = { url: string; init: RequestInit }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function client(respond: (s: Seen) => Response | Promise<Response>, timeoutMs?: number) {
  const seen: Seen[] = []
  const c = createAgentsClient({
    baseUrl: "http://agents.test:8787/",
    serviceToken: SERVICE,
    ...(timeoutMs ? { timeoutMs } : {}),
    fetch: async (url, init) => {
      const s = { url: String(url), init: init ?? {} }
      seen.push(s)
      return respond(s)
    },
  })
  return { c, seen }
}
const caught = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as AgentsError
  }
  throw new Error("expected a rejection")
}

describe("agents client", () => {
  it("sends the service token, the Telegram user and a JSON body", async () => {
    const { c, seen } = client(() => json({ token: "t", sellerId: "ingrid", expiresAt: "2026-11-07T01:00:00.000Z" }))
    const s = await c.sellerSession(1001, "ingrid", "4821")
    expect(s.sellerId).toBe("ingrid")
    expect(seen[0]!.url).toBe("http://agents.test:8787/api/sessions/seller")
    expect(seen[0]!.init.method).toBe("POST")
    expect(seen[0]!.init.headers).toMatchObject({ [BOT_TOKEN_HEADER]: SERVICE, [BOT_USER_HEADER]: "1001", "content-type": "application/json" })
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ sellerId: "ingrid", pin: "4821" })
  })

  it("encodes path segments and sends GETs without a body", async () => {
    const { c, seen } = client(() => json({ sellerId: "a/b", name: "X", address: ADDR }))
    await c.seller(7, "a/b")
    expect(seen[0]!.url).toBe("http://agents.test:8787/api/sellers/a%2Fb")
    expect(seen[0]!.init.body).toBeUndefined()
    expect(seen[0]!.init.headers).not.toHaveProperty("content-type")
  })

  it("validates replies with the shared schemas", async () => {
    const ok = client(() => json({ agentId: ADDR, address: ADDR, token: "w" }))
    expect((await ok.c.walkin(1, "Alice", "USD")).token).toBe("w")
    const bad = client(() => json({ agentId: "not-an-address", token: "w" }))
    expect(await caught(bad.c.walkin(1, "Alice", "USD"))).toMatchObject({ status: 200, code: "bad_response" })
  })

  it("turns the agents service's error body into a code", async () => {
    const { c } = client(() => json({ error: { code: "bad_pin", message: "Wrong PIN" } }, 401))
    expect(await caught(c.sellerSession(1, "ingrid", "0000"))).toMatchObject({ status: 401, code: "bad_pin", message: "Wrong PIN" })
  })

  it("handles an error without a JSON body", async () => {
    const { c } = client(() => new Response("<html>bad gateway</html>", { status: 502 }))
    expect(await caught(c.agent(1, ADDR))).toMatchObject({ status: 502, code: "http_502" })
  })

  it("reports an unreachable service and a timeout, without the PIN or token", async () => {
    const down = client(() => Promise.reject(new TypeError(`fetch failed ${SERVICE}`)))
    const e1 = await caught(down.c.sellerSession(1, "ingrid", "4821"))
    expect(e1).toMatchObject({ status: 0, code: "unreachable" })
    const slow = client(
      (s) =>
        new Promise((_, reject) => {
          s.init.signal!.addEventListener("abort", () => reject(s.init.signal!.reason))
        }),
      20,
    )
    const e2 = await caught(slow.c.sellerSession(1, "ingrid", "4821"))
    expect(e2).toMatchObject({ status: 0, code: "timeout" })
    for (const e of [e1, e2]) {
      expect(e.message).not.toContain("4821")
      expect(e.message).not.toContain(SERVICE)
    }
  })
})

describe("money display", () => {
  it("formats 6-decimal base units exactly", () => {
    expect(formatBase(0n)).toBe("0")
    expect(formatBase(500_000_000n)).toBe("500")
    expect(formatBase(7_650_000n)).toBe("7.65")
    expect(formatBase(1n)).toBe("0.000001")
    expect(formatBase(1_234_567_890_123n)).toBe("1,234,567.890123")
    expect(formatBase(-2_500_000n)).toBe("-2.5")
    // Beyond 2^53: a JS number would round this.
    expect(formatBase(9_007_199_254_740_993_000_001n)).toBe("9,007,199,254,740,993.000001")
    expect(formatMoney("500000000", "EUR")).toBe("500 EUR")
  })
})
