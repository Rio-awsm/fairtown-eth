import { toBase } from "@fairtown/shared"
import { loadEnv } from "@fairtown/shared/env"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { bootstrapFake } from "../src/bootstrap"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { DraftStore } from "../src/listing/drafts"
import { PhotoStore } from "../src/listing/photos"
import { loadReferences } from "../src/listing/references"
import { redact } from "../src/redact"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import { Wallets } from "../src/runtime/wallets"
import { SellerDirectory } from "../src/sellers"
import { buildApp, corsOrigins } from "../src/server"
import { ruleStrategy } from "../src/strategies/rule"
import { buildRelay } from "../../relay/src/server"
import { RelayState } from "../../relay/src/state"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { params } from "./helpers"

const health = { health: async () => ({ ok: true, detail: "mock" }) }

describe("CORS for the web app (S3 on :8080)", () => {
  it("agents allow the web origins with Authorization, and nothing else", async () => {
    const app = buildApp({ config: parseConfig({ PUBLIC_WEB_URL: "https://town.trycloudflare.com", CORS_ORIGINS: "https://extra.example/" }), chain: new FakeChain({ params }), arkiv: new MemoryArkivStore(), ai: health, logger: false })
    const pre = (origin: string) => app.inject({ method: "OPTIONS", url: "/api/handover/ticket", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } })
    for (const o of ["http://localhost:8080", "https://town.trycloudflare.com", "https://extra.example"]) {
      const r = await pre(o)
      expect(r.headers["access-control-allow-origin"]).toBe(o)
      expect(String(r.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization")
    }
    expect((await pre("https://evil.example")).headers["access-control-allow-origin"]).toBeUndefined()
    const get = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://localhost:8080" } })
    expect(get.headers["access-control-allow-origin"]).toBe("http://localhost:8080")
    expect(corsOrigins({ PUBLIC_WEB_URL: "http://localhost:8080/" })).toEqual(["http://localhost:8080", "http://127.0.0.1:8080"])
    await app.close()
  })

  it("the relay lets the web app read /snapshot", async () => {
    const relay = buildRelay({ state: new RelayState(), token: "t", logger: false, corsOrigins: ["http://localhost:8080"] })
    const ok = await relay.app.inject({ method: "GET", url: "/snapshot", headers: { origin: "http://localhost:8080" } })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:8080")
    expect((await relay.app.inject({ method: "GET", url: "/snapshot", headers: { origin: "https://evil.example" } })).headers["access-control-allow-origin"]).toBeUndefined()
    await relay.app.close()
  })
})

describe("an RPC outage never takes the service down", () => {
  it("a loop tick reports the error (redacted) instead of rejecting", async () => {
    const wallets = new Wallets(generateMnemonic(english))
    const chain = new FakeChain({ params, accountFor: wallets.accountFor })
    const errors: string[] = []
    const runtime = new AgentRuntime({ chain, wallets, publisher: new MemoryPublisher(), strategy: ruleStrategy, onError: (w, e) => errors.push(`${w}: ${redact(e)}`) })
    runtime.addPersonas(PERSONAS)
    chain.blockNumber = async () => {
      throw new Error("HTTP request failed. URL: https://base-sepolia.g.alchemy.com/v2/SECRETKEY123 Details: timeout")
    }
    await expect(runtime.tick()).resolves.toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("<url>")
    expect(errors[0]).not.toContain("SECRETKEY123")
  })

  it("redact strips URLs, bearer tokens and labelled keys but keeps tx hashes", () => {
    const tx = `0x${"ab".repeat(32)}`
    const s = redact(new Error(`wss://x.example/ws?key=abc Bearer abc.def private_key=0x${"1".repeat(64)} tx ${tx}`))
    expect(s).not.toContain("x.example")
    expect(s).not.toContain("abc.def")
    expect(s).not.toContain("1".repeat(64))
    expect(s).toContain(tx)
  })
})

describe("lot view and seller history in the shapes S3 reads", () => {
  async function soldLot(tee?: boolean) {
    const fake = new FakeAi()
      .on("listing", () => ({ commodity: "cod", quantity: 600, unit: "kg", place: "Bergen" }))
      .on("vision", () => ({ grade: "fresh_a", defects: [], confidence: 0.8, lotCodeVisible: true }))
    const ai = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
    const chain = new FakeChain({ params })
    const sellers = new SellerDirectory(PERSONAS)
    await bootstrapFake(chain, sellers, PERSONAS)
    const drafts = new DraftStore()
    const buyer = sellers.get("hanse_kitchen")!.address
    const app = buildApp({
      config: parseConfig({}),
      chain,
      arkiv: new MemoryArkivStore(),
      ai,
      listing: { ai, sellers, photos: new PhotoStore(mkdtempSync(join(tmpdir(), "p-"))), drafts, references: loadReferences(), winnersOf: async (id) => [{ buyer, tokenAmount: await chain.tokenBalance(id, buyer) }] },
      logger: false,
    })
    const draft = (await app.inject({ method: "POST", url: "/api/listings/draft", payload: { sellerId: "ingrid", text: "600 kg cod, Bergen" } })).json()
    if (tee !== undefined) drafts.get(draft.draftId)!.trace = { requestId: "r", provider: "0xp", teeVerified: tee }
    const { lotId } = (await app.inject({ method: "POST", url: "/api/listings/confirm", payload: { draftId: draft.draftId, floorPerUnit: toBase("7.50").toString(), durationBlocks: 45 } })).json()
    await chain.mint("EUR", buyer, toBase("6000"))
    const lot = await chain.getLot(BigInt(lotId))
    await chain.ensurePermit2(buyer, "EUR", lot.auction)
    await chain.submitBid(buyer, { lotId: BigInt(lotId), maxPerUnit: toBase("9.00"), amount: toBase("5400") })
    chain.mine(50)
    return { app, lotId: String(lotId), buyer }
  }

  it("LotView carries winners and gradeReport.tee_verified (true only when attested)", async () => {
    const t = await soldLot(true)
    const v = (await t.app.inject({ method: "GET", url: `/api/lots/${t.lotId}` })).json()
    expect(v.winners).toEqual([{ buyer: t.buyer, tokenAmount: (600n * 10n ** 18n).toString() }])
    expect(v.gradeReport).toMatchObject({ tee_verified: true, verification: { state: "verified" } })
    const u = await soldLot(false)
    expect((await u.app.inject({ method: "GET", url: `/api/lots/${u.lotId}` })).json().gradeReport).toMatchObject({ tee_verified: false, verification: { state: "failed" } })
  })

  it("seller history has lots with units and payout rows by kind", async () => {
    const t = await soldLot()
    const p = (await t.app.inject({ method: "GET", url: "/api/sellers/ingrid" })).json()
    expect(p.lots[0]).toMatchObject({ lotId: t.lotId, commodity: "cod", qty: "600", unit: "kg", status: "sold" })
    expect(p.payouts).toEqual([{ lotId: t.lotId, kind: "at_sale", amount: expect.stringMatching(/^\d+$/), currency: "EUR" }])
  })
})

describe(".env.example", () => {
  it("parses as-is (no placeholder crashes the service)", () => {
    const { env } = loadEnv(new URL("../../../.env.example", import.meta.url).pathname, {})
    expect(() => parseConfig(env)).not.toThrow()
    for (const k of ["SELLER_PIN", "TRUST_PROXY", "CORS_ORIGINS", "LLM_MAX_RPM", "VISION_FALLBACK", "ADDON_SWARM", "SWARM_BATCH_ID", "ENS_PRIVATE_KEY", "HEDERA_AGENT_ACCOUNT_ID", "CHAIN_BACKFILL_BLOCKS"]) expect(k in env).toBe(true)
  })
})
