import { HealthResponse } from "@fairtown/shared/api"
import { afterEach, describe, expect, it } from "vitest"
import { createAdapters } from "../src/adapters"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { FakeChain } from "../src/chain/fake/FakeChain"
import type { ChainAdapter } from "../src/chain/types"
import { ConfigError, parseConfig, pickupWindowFor, protocolParams } from "../src/config"
import { buildApp } from "../src/server"
import { params } from "./helpers"

describe("config", () => {
  it("defaults to mock modes and contract values", () => {
    const c = parseConfig({})
    expect(c).toMatchObject({ AGENTS_PORT: 8787, CHAIN_MODE: "fake", ARKIV_MODE: "memory", MOCK_AI: true, FEE_BPS: 100 })
    expect(protocolParams(c)).toEqual({ ...params, contestWindowBlocks: 600n, reportWindowBlocks: 3000n })
    expect(pickupWindowFor(c, "produce")).toBe(4500n)
    expect(pickupWindowFor(c, "compute")).toBe(600n)
  })
  it("parses .env.example style values and ignores empty ones", () => {
    const c = parseConfig({ CHAIN_MODE: "base-sepolia", MOCK_AI: "0", CONTEST_WINDOW_BLOCKS: "90", TREASURY_ADDRESS: "" })
    expect(c.MOCK_AI).toBe(false)
    expect(c.CONTEST_WINDOW_BLOCKS).toBe(90n)
    expect(c.TREASURY_ADDRESS).toBeUndefined()
  })
  it("names bad keys without echoing values", () => {
    const run = () => parseConfig({ FEE_BPS: "20000", CHAIN_MODE: "mainnet", CONTEST_WINDOW_BLOCKS: "abc" })
    expect(run).toThrow(ConfigError)
    try {
      run()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("FEE_BPS")
      expect(msg).toContain("CHAIN_MODE")
      expect(msg).toContain("CONTEST_WINDOW_BLOCKS")
      expect(msg).not.toContain("mainnet")
      expect(msg).not.toContain("20000")
    }
  })
})

describe("agents server", () => {
  const apps: ReturnType<typeof buildApp>[] = []
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
  })
  const okAi = { health: async () => ({ ok: true, detail: "mock" }) }
  const make = (env: Record<string, string> = {}, chain: ChainAdapter = new FakeChain({ params }), ai = okAi) => {
    const app = buildApp({ config: parseConfig(env), chain, arkiv: new MemoryArkivStore(), ai, logger: false })
    apps.push(app)
    return app
  }

  it("reports healthy in mock mode", async () => {
    const res = await make().inject({ method: "GET", url: "/api/health" })
    expect(res.statusCode).toBe(200)
    const body = HealthResponse.parse(res.json())
    expect(body).toMatchObject({ ok: true, chain: { ok: true, detail: "fake at block 1" }, arkiv: { detail: "memory" } })
  })
  it("reports an unreachable chain", async () => {
    const broken = new FakeChain({ params })
    broken.blockNumber = async () => {
      throw new Error("rpc down")
    }
    const body = (await make({}, broken).inject({ method: "GET", url: "/api/health" })).json()
    expect(body.ok).toBe(false)
    expect(body.chain).toEqual({ ok: false, detail: "rpc down" })
  })
  it("reports the AI gateway's health", async () => {
    const down = { health: async () => ({ ok: false, detail: "gateway unreachable" }) }
    const body = (await make({}, new FakeChain({ params }), down).inject({ method: "GET", url: "/api/health" })).json()
    expect(body.ok).toBe(false)
    expect(body.ai.ok).toBe(false)
  })
  it("returns the contract error shape for unknown routes", async () => {
    const res = await make().inject({ method: "GET", url: "/api/nope" })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: "not_found", message: "GET /api/nope not found" } })
  })
})

describe("createAdapters", () => {
  it("builds fake chain and memory store", async () => {
    const a = await createAdapters(parseConfig({}))
    a.stop()
    expect(a.chain.mode).toBe("fake")
    expect(a.arkiv.mode).toBe("memory")
  })
  it("refuses live modes without their keys", async () => {
    await expect(createAdapters(parseConfig({ CHAIN_MODE: "base-sepolia" }))).rejects.toThrow(/OPERATOR_PRIVATE_KEY/)
    await expect(createAdapters(parseConfig({ ARKIV_MODE: "live" }))).rejects.toThrow(/ARKIV_ACCESS_KEY/)
  })
})
