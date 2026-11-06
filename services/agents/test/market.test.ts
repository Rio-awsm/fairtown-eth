import { toBase } from "@fairtown/shared"
import { AdviceResponse, FxResponse } from "@fairtown/shared/api"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi, type FakeInput } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { findReference, loadReferences } from "../src/listing/references"
import { sellerAdvice } from "../src/market/advice"
import { MarketState, moveOnSignal } from "../src/market/state"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import type { LotObservation, Strategy } from "../src/runtime/types"
import { Wallets } from "../src/runtime/wallets"
import { SellerDirectory } from "../src/sellers"
import { buildApp } from "../src/server"
import { createLlmStrategy } from "../src/strategies/llm"
import { ruleStrategy } from "../src/strategies/rule"
import { codSpec, params } from "./helpers"

function setup(strategy: Strategy = ruleStrategy) {
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const references = loadReferences()
  const market = new MarketState({ chain, references })
  market.start()
  const publisher = new MemoryPublisher()
  const marketFor = (lot: LotObservation, block: bigint) => {
    const r = findReference(references, lot.commodity, lot.place)
    return { ...(r && r.currency === lot.currency ? { reference: BigInt(r.perUnit) } : {}), signals: market.signalsFor(lot.place, lot.sector, block), urgencyBps: market.urgencyBps(lot.place, lot.sector, block) }
  }
  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy, marketFor })
  runtime.addPersonas(PERSONAS)
  runtime.watchOnly()
  const addr = (id: string) => wallets.address(PERSONAS.findIndex((p) => p.id === id))
  const sellers = new SellerDirectory(PERSONAS, (p) => wallets.address(PERSONAS.indexOf(p)))
  return { wallets, chain, references, market, publisher, runtime, addr, sellers }
}

const storm = (severity: number, place = "bergen", expiresAtBlock = 500n) => ({ kind: "weather" as const, place: place as "bergen", severity, expiresAtBlock, label: `Storm forecast, ${place}` })

describe("market state from SignalOracle events", () => {
  it("tracks signals by place and sector, reaches the market town, and drops them at expiry", () => {
    const t = setup()
    t.chain.pushSignal(storm(4))
    t.chain.pushSignal({ kind: "festival", place: "mumbai", severity: 5, expiresAtBlock: 500n, label: "Diwali in 3 days" })
    expect(t.market.signalsFor("bergen", "fish", 10n).map((s) => s.label)).toEqual(["Storm forecast, bergen"])
    expect(t.market.signalsFor("bergen", "compute", 10n)).toEqual([])
    expect(t.market.signalsFor("pune", "flowers", 10n).map((s) => s.label)).toEqual(["Diwali in 3 days"])
    expect(t.market.signalsFor("bergen", "fish", 500n)).toEqual([])
  })

  it("turns severity into urgency: storms push up, dips pull down, floor at x0.5", () => {
    const t = setup()
    expect(t.market.urgencyBps("bergen", "fish", 1n)).toBe(10000)
    t.chain.pushSignal(storm(5))
    expect(t.market.urgencyBps("bergen", "fish", 1n)).toBe(15000)
    t.chain.pushSignal({ kind: "demand_dip", place: "bergen", severity: 2, expiresAtBlock: 500n, label: "Quiet dock" })
    expect(t.market.urgencyBps("bergen", "fish", 1n)).toBe(13000)
    t.chain.pushSignal({ kind: "demand_dip", place: "lagos", severity: 9, expiresAtBlock: 500n, label: "Glut at Mile 12" })
    expect(t.market.urgencyBps("lagos", "produce", 1n)).toBe(5000)
  })

  it("upserts reference updates into the shared rows and ignores zero prices; FX updates /api/fx", async () => {
    const t = setup()
    t.chain.pushReference("cod", "bergen", toBase("9.00"), "EUR", "rafisklaget")
    t.chain.pushReference("tomato", "lagos", 0n, "USD", "broken")
    expect(findReference(t.references, "cod", "bergen")).toMatchObject({ perUnit: "9000000", source: "CRE W1: rafisklaget" })
    expect(findReference(t.references, "tomato", "lagos")!.perUnit).toBe("380000")
    t.chain.pushFx("INR", 8_350_000_000n)
    const app = buildApp({ config: parseConfig({}), chain: t.chain, arkiv: new MemoryArkivStore(), ai: { health: async () => ({ ok: true, detail: "mock" }) }, market: { market: t.market, arkiv: new MemoryArkivStore(), chain: t.chain, references: t.references, sellers: t.sellers, params }, logger: false })
    const fx = FxResponse.parse((await app.inject({ method: "GET", url: "/api/fx" })).json())
    expect(fx.rates.INR).toBe(83.5)
    expect(fx.rates.EUR).toBe(0.92)
    expect(fx.source).toContain("CRE W1")
    await app.close()
  })

  it("moves affected buyers to their market; place-bound mandates elsewhere stay put", async () => {
    const t = setup()
    const sent: unknown[] = []
    const n = await moveOnSignal({ ...storm(3, "lagos"), id: 1n }, ["fish", "produce"], t.runtime.agents.values(), async (ev) => void sent.push(...ev))
    const movers = (sent as Array<{ agentId: Address; moveTo: string; reason: string }>).map((e) => ({ id: t.runtime.agents.get(e.agentId)!.personaId, to: e.moveTo }))
    expect(n).toBe(sent.length)
    expect(movers).toContainEqual({ id: "mile12_coop", to: "harvest_hall" })
    expect(movers).toContainEqual({ id: "hanse_kitchen", to: "fish_dock" })
    expect(movers.some((m) => m.id === "gulf_produce")).toBe(false)
  })
})

describe("agents react to signals inside mandates", () => {
  async function firstBid(withStorm: boolean) {
    const t = setup()
    await t.runtime.bootstrap(undefined, [])
    if (withStorm) t.chain.pushSignal(storm(5))
    const ingrid = t.addr("ingrid")
    await t.chain.createLot(ingrid, codSpec(ingrid))
    await t.runtime.step()
    const d = t.runtime.log.find((x) => x.result.status === "bid")!
    const intent = t.publisher.sent.find((e) => e.event.type === "agent.intent" && e.event.action === "bid")!
    return { d, intent, t }
  }

  it("steps up 5 ticks instead of 3 in a severity-5 storm, says why, and never passes the mandate max", async () => {
    const calm = await firstBid(false)
    const stormy = await firstBid(true)
    if (calm.d.result.status !== "bid" || stormy.d.result.status !== "bid") throw new Error("expected bids")
    const floor = toBase("7.50")
    const tick = (calm.d.result.maxPerUnit - floor) / 3n
    expect(calm.d.result.maxPerUnit).toBe(floor + 3n * tick)
    expect(stormy.d.result.maxPerUnit).toBe(floor + 5n * tick)
    expect(stormy.intent.event.type === "agent.intent" && stormy.intent.event.reason).toContain("Storm forecast, bergen")
    for (const x of stormy.t.runtime.log) if (x.result.status === "bid") expect(x.result.maxPerUnit <= BigInt(stormy.t.runtime.agents.get(x.agentId)!.mandate!.maxPerUnit)).toBe(true)
  })

  it("gives the LLM the live signals and the updated reference", async () => {
    const seen: FakeInput[] = []
    const ai = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake: new FakeAi().on("bidder", (i) => (seen.push(i), { action: "pass", reason: "Waiting" })) })
    const t = setup(createLlmStrategy({ ai }))
    await t.runtime.bootstrap(undefined, [])
    t.chain.pushSignal(storm(3))
    t.chain.pushReference("cod", "bergen", toBase("9.00"), "EUR", "rafisklaget")
    const ingrid = t.addr("ingrid")
    await t.chain.createLot(ingrid, codSpec(ingrid))
    await t.runtime.step()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]!.prompt).toContain("Storm forecast, bergen (weather, bergen, severity 3)")
    expect(seen[0]!.prompt).toContain("reference 9")
  })
})

describe("seller advice", () => {
  async function ledger(arkiv: MemoryArkivStore, seller: Address) {
    for (const [lotId, p] of [[1n, "9.10"], [2n, "8.70"], [3n, "9.30"]] as const)
      await arkiv.put(ARKIV_SCHEMAS.price, { sector: "fish", commodity: "cod", grade: "fresh_a", market: "fish_dock", place: "bergen", currency: "EUR", lotId, finalClearingPerUnit: toBase(p), avgPerUnit: toBase(p), soldUnits: 600n, day: "2026-11-06", tx: "0x" }, { owner: seller, expiresInSeconds: 3600 })
    await arkiv.put(ARKIV_SCHEMAS.reputation, { seller, tier: "new", cleanLots: 1n, noShows: 0n, day: "2026-11-06", lastLotId: 3n, tx: "0x" }, { owner: seller, expiresInSeconds: 3600 })
  }

  it("grounds every number in its basis: clears from Arkiv, reference, floor, signals, tier", async () => {
    const t = setup()
    const arkiv = new MemoryArkivStore()
    await ledger(arkiv, t.addr("ingrid"))
    t.chain.pushSignal(storm(4))
    const r = await sellerAdvice({ arkiv, chain: t.chain, references: t.references, market: t.market, params }, t.sellers.get("ingrid")!)
    expect(r.basis.medianClear).toBe(toBase("9.10").toString())
    expect(r.basis.recentClears).toHaveLength(3)
    expect(r.basis.reference!.perUnit).toBe("8300000")
    expect(r.basis.reputation).toMatchObject({ source: "arkiv", cleanLots: 1, noShows: 0 })
    expect(r.advice).toContain("median €9.10 over the last 3 lots, above the €8.30 reference")
    expect(r.advice).toContain(`A floor near €${(Number(BigInt(r.basis.suggestedFloor!.perUnit) / 10_000n) / 100).toFixed(2)} should sell`)
    expect(r.advice).toContain("Storm forecast, bergen: buyers are keen")
    expect(r.advice).toContain("You're new: 50% at sale, the rest at handover. 2 more clean lots make you proven (90% at sale).")
  })

  it("still advises from the chain record when Arkiv is down, and the route serves it", async () => {
    const t = setup()
    const down = { query: async () => { throw new Error("rabdi down") } }
    const r = await sellerAdvice({ arkiv: down, chain: t.chain, references: t.references, params }, t.sellers.get("amina")!)
    expect(r.basis.arkiv).toBe("unavailable, chain record used")
    expect(r.advice).toContain("No tomato sales at lagos on the ledger yet; the reference is $0.38")

    const arkiv = new MemoryArkivStore()
    await ledger(arkiv, t.addr("ingrid"))
    const app = buildApp({ config: parseConfig({}), chain: t.chain, arkiv, ai: { health: async () => ({ ok: true, detail: "mock" }) }, market: { market: t.market, arkiv, chain: t.chain, references: t.references, sellers: t.sellers, params }, logger: false })
    const ok = await app.inject({ method: "GET", url: "/api/sellers/ingrid/advice" })
    expect(ok.statusCode).toBe(200)
    expect(AdviceResponse.parse(ok.json()).advice).toContain("€9.10")
    expect((await app.inject({ method: "GET", url: "/api/sellers/nobody/advice" })).statusCode).toBe(404)
    await app.close()
  })
})
