import { describe, expect, it } from "vitest"
import { runChecks, type Env } from "../core"
import { RABDI_PUBLIC_RPC, s2Checks, type S2Deps } from "./s2"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const deps = (over: Partial<S2Deps> = {}): S2Deps => ({
  fetch: async () => json({}),
  portFree: async () => true,
  ...over,
})
const run = async (env: Env, d: S2Deps = deps()) => {
  const rows = await runChecks(s2Checks(d), { env, envFileFound: true, versions: { node: "22.18.0", pnpm: "9.15.9" } })
  return Object.fromEntries(rows.map((r) => [r.id, r]))
}
const MOCK: Env = { ARKIV_MODE: "memory", MOCK_AI: "1", CHAIN_MODE: "fake" }

describe("S2 doctor rows", () => {
  it("are all ok in mock mode", async () => {
    const rows = await run(MOCK)
    expect(Object.values(rows).map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"])
    expect(Object.values(rows).every((r) => r.owner === "S2")).toBe(true)
  })

  it("checks the Rabdi chain id in live mode without printing the key", async () => {
    let url = ""
    const ok = await run(
      { ...MOCK, ARKIV_MODE: "live", ARKIV_ACCESS_KEY: "secret-key-123" },
      deps({
        fetch: async (u) => {
          url = String(u)
          return json({ result: "0x76edaf" })
        },
      }),
    )
    expect(url).toBe(RABDI_PUBLIC_RPC)
    expect(ok["s2-arkiv"]!.status).toBe("ok")
    expect(ok["s2-arkiv"]!.detail).not.toContain("secret-key-123")
    const wrong = await run({ ...MOCK, ARKIV_MODE: "live", ARKIV_ACCESS_KEY: "k" }, deps({ fetch: async () => json({ result: "0x1" }) }))
    expect(wrong["s2-arkiv"]!.status).toBe("fail")
    const down = await run(
      { ...MOCK, ARKIV_MODE: "live", ARKIV_ACCESS_KEY: "k" },
      deps({ fetch: async () => Promise.reject(new Error("offline")) }),
    )
    expect(down["s2-arkiv"]!.status).toBe("warn")
    expect((await run({ ...MOCK, ARKIV_MODE: "live" }))["s2-arkiv"]!.status).toBe("fail")
  })

  it("checks the LLM endpoint and configured models", async () => {
    const env = { ...MOCK, MOCK_AI: "0", LLM_BASE_URL: "http://localhost:11434/v1/", LLM_API_KEY: "local", BIDDER_MODEL: "qwen3:8b" }
    const served = deps({ fetch: async () => json({ data: [{ id: "qwen3:8b" }] }) })
    expect((await run(env, served))["s2-llm"]!.status).toBe("ok")
    const missing = deps({ fetch: async () => json({ data: [{ id: "llama3" }] }) })
    expect((await run(env, missing))["s2-llm"]!.detail).toContain("qwen3:8b")
    expect((await run(env, deps({ fetch: async () => json({}, 500) })))["s2-llm"]!.status).toBe("fail")
    expect((await run(env, deps({ fetch: async () => Promise.reject(new Error("x")) })))["s2-llm"]!.status).toBe("fail")
    expect((await run({ ...env, LLM_BASE_URL: "" }))["s2-llm"]!.status).toBe("fail")
  })

  it("warns on busy ports", async () => {
    const rows = await run(MOCK, deps({ portFree: async (p) => p !== 8788 }))
    expect(rows["s2-ports"]).toMatchObject({ status: "warn", detail: "In use: 8788 (service already running?)" })
  })

  it("fails an enabled add-on with missing env, naming variables only", async () => {
    const rows = await run({ ...MOCK, ADDON_WORLD: "1", WORLD_CLIENT_ID: "abc" })
    expect(rows["s2-addons"]).toMatchObject({ status: "fail", detail: "Missing for ADDON_WORLD: WORLD_CLIENT_SECRET" })
    expect(rows["s2-addons"]!.detail).not.toContain("abc")
  })
})
