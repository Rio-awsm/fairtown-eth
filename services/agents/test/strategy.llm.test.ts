import { toBase } from "@fairtown/shared"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import type { Address } from "viem"
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi, type FakeInput } from "../src/ai/fake"
import { AiError, createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { PERSONAS } from "../src/fixtures/personas"
import { loadReferences } from "../src/listing/references"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import type { Observation, RuntimeAgent } from "../src/runtime/types"
import { Wallets } from "../src/runtime/wallets"
import { buildCases, loadFixtureLots, reportMarkdown, runEval } from "../src/eval/bidderEval"
import { createLlmStrategy, marketContext, observationText, personaPrompt, toDecision, wordCount, type BidAdvice } from "../src/strategies/llm"
import { codSpec, params } from "./helpers"

const AGENT = "0x00000000000000000000000000000000000000a1" as Address
const SELLER = "0x00000000000000000000000000000000000000b2" as Address

function obs(over: { agent?: Partial<RuntimeAgent>; lot?: Partial<Observation["lot"]>; myBestOnLot?: bigint } = {}): Observation {
  return {
    agent: {
      agentId: AGENT,
      name: "Hanse Kitchen Group",
      role: "BUYER",
      kind: "buyer",
      building: "fish_dock",
      sprite: "chef",
      currency: "EUR",
      budget: toBase("20000"),
      mandate: { commodities: ["cod"], maxPerUnit: toBase("9.80").toString(), qty: "400", avoidNoShowSellers: true },
      paused: false,
      walletIndex: 0,
      personaId: "hanse_kitchen",
      ...over.agent,
    },
    budgetLeft: toBase("20000"),
    exposureOnLot: 0n,
    myBestOnLot: over.myBestOnLot ?? 0n,
    lot: {
      lotId: 1n,
      auction: "0x00000000000000000000000000000000000000c3",
      sector: "fish",
      commodity: "cod",
      grade: "fresh_a",
      building: "fish_dock",
      place: "bergen",
      seller: SELLER,
      sellerName: "Ingrid Solheim",
      sellerRecord: { cleanLots: 0, noShows: 0, proven: false },
      currency: "EUR",
      qty: 600n,
      floorPerUnit: toBase("7.50"),
      clearingPerUnit: toBase("8.00"),
      tickPerUnit: toBase("0.08"),
      endBlock: 450n,
      blocksLeft: 300n,
      ...over.lot,
    },
  }
}

const advice = (a: Partial<BidAdvice> = {}): BidAdvice => ({ action: "bid", maxPerUnit: "9.40", qty: "400", reason: "Cod's grade A and Ingrid's new, capping at €9.40", ...a })

function mockAi(handler: (i: FakeInput) => unknown) {
  const fake = new FakeAi().on("bidder", handler)
  return createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
}

describe("LLM strategy: prompts", () => {
  it("keeps every bidding persona prompt under 150 words", () => {
    for (const p of PERSONAS.filter((x) => x.mandate)) {
      const a = obs({ agent: { name: p.name, kind: p.kind, personaId: p.id } }).agent
      expect(wordCount(personaPrompt(a, p.bio))).toBeLessThan(150)
    }
  })

  it("sends no key or mnemonic to the model, only public market state", async () => {
    const mnemonic = generateMnemonic(english)
    const wallets = new Wallets(mnemonic)
    const pk = mnemonicToAccount(mnemonic, { addressIndex: 0 }).getHdKey().privateKey!
    const pkHex = Buffer.from(pk).toString("hex")
    const seen: FakeInput[] = []
    const s = createLlmStrategy({ ai: mockAi((i) => (seen.push(i), advice())) })
    await s.decide(obs({ agent: { agentId: wallets.address(0) } }))
    expect(seen).toHaveLength(1)
    const sent = seen[0]!.system + seen[0]!.prompt
    expect(sent).not.toContain(pkHex)
    expect(sent).not.toContain(mnemonic.split(" ").slice(0, 4).join(" "))
    expect(sent).not.toMatch(/[0-9a-f]{64}/i)
    expect(sent).toContain("clearing 8")
    expect(sent).toContain("Ingrid Solheim (new: 0 clean lots, 0 no-shows)")
  })

  it("shows reference, recent clears and signals in display units", () => {
    const text = observationText(obs(), { reference: toBase("8.30"), recentClears: [toBase("9.10")], signals: [{ kind: "weather", place: "bergen", severity: 3, label: "Storm tomorrow" }] })
    expect(text).toContain("reference 8.3")
    expect(text).toContain("recent clears 9.1")
    expect(text).toContain("Storm tomorrow (weather, bergen, severity 3)")
    expect(text).toContain("about 60 s")
  })
})

describe("LLM strategy: advice to Decision", () => {
  it("converts display price and qty to bigint base units", () => {
    expect(toDecision(advice(), obs())).toEqual({ action: "bid", maxPerUnit: "9400000", amount: (400n * 9_400_000n).toString(), moveTo: "fish_dock", reason: "Cod's grade A and Ingrid's new, capping at €9.40" })
  })

  it("lifts a price below clearing plus one tick to the lowest valid price", () => {
    expect(toDecision(advice({ maxPerUnit: "7.00" }), obs())!.maxPerUnit).toBe("8080000")
  })

  it("caps qty at the lot size and trims the reason to 80 characters", () => {
    const d = toDecision(advice({ qty: "5000", reason: `  ${"x".repeat(120)}  ` }), obs())!
    expect(d.amount).toBe((600n * 9_400_000n).toString())
    expect(d.reason).toHaveLength(80)
  })

  it("rejects unusable advice: bid without price, zero qty, blank reason", () => {
    expect(toDecision(advice({ maxPerUnit: undefined }), obs())).toBeNull()
    expect(toDecision(advice({ qty: "0" }), obs())).toBeNull()
    expect(toDecision(advice({ reason: "   " }), obs())).toBeNull()
  })
})

describe("LLM strategy: fallback and cache", () => {
  it("falls back to rules on invalid model output", async () => {
    const s = createLlmStrategy({ ai: mockAi(() => ({ action: "buy", price: 9 })) })
    const d = await s.decide(obs())
    expect(d.action).toBe("bid")
    expect(d.maxPerUnit).toBe((toBase("8.00") + 3n * toBase("0.08")).toString()) // rule: 3 ticks above clearing
    expect(s.stats().fallbacks.invalid_output).toBe(1)
  })

  it("falls back to rules on timeout and provider errors", async () => {
    let code: "timeout" | "provider_error" = "timeout"
    const s = createLlmStrategy({ ai: { decide: async () => { throw new AiError(code, "x") } } })
    expect((await s.decide(obs())).action).toBe("bid")
    code = "provider_error"
    expect((await s.decide(obs({ lot: { clearingPerUnit: toBase("8.50") } }))).action).toBe("bid")
    expect(s.stats().fallbacks).toMatchObject({ timeout: 1, provider_error: 1 })
  })

  it("falls back when the advice is unusable", async () => {
    const s = createLlmStrategy({ ai: mockAi(() => advice({ maxPerUnit: undefined })) })
    expect((await s.decide(obs())).reason).toContain("bidding")
    expect(s.stats().fallbacks.unusable).toBe(1)
  })

  it("never asks the model on hard passes: no-show seller, over max, still winning", async () => {
    let calls = 0
    const s = createLlmStrategy({ ai: mockAi(() => (calls++, advice())) })
    expect((await s.decide(obs({ lot: { sellerRecord: { cleanLots: 0, noShows: 1, proven: false } } }))).action).toBe("pass")
    expect((await s.decide(obs({ lot: { clearingPerUnit: toBase("9.80") } }))).action).toBe("pass")
    expect((await s.decide(obs({ myBestOnLot: toBase("8.50") }))).action).toBe("pass")
    expect(calls).toBe(0)
    expect(s.stats().hardRule).toBe(3)
  })

  it("caches by observation for 10 blocks; a clearing move is a new observation", async () => {
    let calls = 0
    const s = createLlmStrategy({ ai: mockAi(() => (calls++, advice())) })
    await s.decide(obs({ lot: { blocksLeft: 280n } }))
    await s.decide(obs({ lot: { blocksLeft: 271n } })) // 9 blocks later, same urgency bucket
    expect(calls).toBe(1)
    await s.decide(obs({ lot: { blocksLeft: 270n } })) // 10 blocks later
    expect(calls).toBe(2)
    await s.decide(obs({ lot: { blocksLeft: 269n, clearingPerUnit: toBase("8.20") } }))
    expect(calls).toBe(3)
    await s.decide(obs({ lot: { blocksLeft: 249n, clearingPerUnit: toBase("8.20") } })) // urgency bucket changed
    expect(calls).toBe(4)
    expect(s.stats()).toMatchObject({ decisions: 5, llm: 4, cached: 1, firstTry: 4 })
  })
})

describe("marketContext", () => {
  it("uses same-currency references and the latest Arkiv clears, and survives Arkiv errors", async () => {
    const arkiv = new MemoryArkivStore()
    for (const [lotId, p] of [[1n, "9.10"], [2n, "8.90"]] as const)
      await arkiv.put(
        ARKIV_SCHEMAS.price,
        { sector: "fish", commodity: "cod", grade: "fresh_a", market: "fish_dock", place: "bergen", currency: "EUR", lotId, finalClearingPerUnit: toBase(p), avgPerUnit: toBase(p), soldUnits: 600n, day: 20261106n, tx: "0x" },
        { owner: SELLER, expiresInSeconds: 3600 },
      )
    const ctx = marketContext({ references: loadReferences(), arkiv })
    const c = await ctx(obs().lot)
    expect(c.reference).toBe(toBase("8.30"))
    expect(c.recentClears).toEqual([toBase("8.90"), toBase("9.10")])
    expect((await ctx(obs({ lot: { currency: "USD" } }).lot)).reference).toBeUndefined()

    const broken = marketContext({ references: [], arkiv: { query: async () => { throw new Error("rabdi down") } } })
    expect(await broken(obs().lot)).toEqual({ recentClears: [], signals: [] })
  })
})

describe("LLM strategy in the runtime on FakeChain", () => {
  it("bids through guardrails with LLM reasons; an over-max price is clamped to the mandate", async () => {
    const wallets = new Wallets(generateMnemonic(english))
    const chain = new FakeChain({ params, accountFor: wallets.accountFor })
    const publisher = new MemoryPublisher()
    const strategy = createLlmStrategy({ ai: mockAi(() => advice({ maxPerUnit: "99.00", reason: "Storm coming, I want this cod" })) })
    const runtime = new AgentRuntime({ chain, wallets, publisher, strategy })
    runtime.addPersonas(PERSONAS)
    await runtime.bootstrap(undefined, [])
    runtime.watchOnly()
    const ingrid = wallets.address(PERSONAS.findIndex((p) => p.id === "ingrid"))
    const { lotId } = await chain.createLot(ingrid, codSpec(ingrid))
    for (let i = 0; i < 16; i++) {
      await runtime.step()
      chain.mine(3)
    }
    const bids = runtime.log.filter((d) => d.result.status === "bid")
    expect(bids.length).toBeGreaterThan(0)
    for (const b of bids) {
      if (b.result.status !== "bid") continue
      expect(b.result.maxPerUnit).toBe(BigInt(runtime.agents.get(b.agentId)!.mandate!.maxPerUnit))
      expect(b.result.clamped).toContain("price clamped to mandate max")
    }
    const intents = publisher.sent.filter((e) => e.event.type === "agent.intent" && e.event.action === "bid")
    expect(intents.every((e) => e.event.type === "agent.intent" && e.event.reason === "Storm coming, I want this cod")).toBe(true)
    expect((await chain.getLot(lotId)).status).toBe("sold")
    expect(strategy.stats().llm).toBeGreaterThan(0)
  })
})

describe("bidder eval", () => {
  const cases = buildCases(PERSONAS, loadFixtureLots(), 200)

  it("builds 200 distinct cases where rules would bid", () => {
    expect(cases).toHaveLength(200)
    expect(new Set(cases.map((c) => JSON.stringify([c.o.agent.personaId, `${c.o.lot.lotId}:${c.o.lot.clearingPerUnit}:${c.o.lot.blocksLeft}`, c.o.lot.sellerRecord.proven, c.signals.length]))).size).toBe(200)
  })

  it("passes thresholds with a well-behaved fake provider", async () => {
    const r = await runEval({ ai: mockAi(() => advice({ qty: undefined })), provider: "test", cases, references: loadReferences() })
    expect(r).toMatchObject({ n: 200, schemaValid: 1, fallbackRate: 0, pass: true })
    expect(r.guardrails.rejected).toBe(0)
  })

  it("fails thresholds when a fifth of answers are invalid", async () => {
    let i = 0
    const r = await runEval({ ai: mockAi(() => (i++ % 5 === 0 ? { nope: true } : advice())), provider: "test", cases })
    expect(r.fallbackRate).toBeCloseTo(0.2, 2)
    expect(r.pass).toBe(false)
    expect(r.samples.filter((s) => s.source === "rules")).toHaveLength(40)
    expect(reportMarkdown(r)).toContain("| Fallback to rules | 20.0% | <= 10.0% | FAIL |")
  })
})
