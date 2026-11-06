import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import type { ArkivStore } from "../src/arkiv/ArkivStore"
import { LedgerWriter } from "../src/arkiv/ledgerWriter"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { ChainFeed } from "../src/chain/feed"
import type { ChainEvent, EventArgs } from "../src/chain/types"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { healthExtras } from "../src/health"
import { loadReferences } from "../src/listing/references"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import type { Strategy } from "../src/runtime/types"
import { Wallets } from "../src/runtime/wallets"
import { SectorEngine } from "../src/sectors/engine"
import { AUCTION_BLOCKS_FAKE } from "../src/sectors/rules"
import { buildApp } from "../src/server"
import { createLlmStrategy } from "../src/strategies/llm"
import { ruleStrategy } from "../src/strategies/rule"
import { codSpec, params } from "./helpers"

const RULES = { auctionBlocks: AUCTION_BLOCKS_FAKE, pickupBlocks: { fish: 200n, flowers: 200n, produce: 200n, truck: 200n, storage: 100n, compute: 60n }, arriveBlocks: 5n, travelBlocks: 10n }

async function town(strategy: Strategy = ruleStrategy) {
  let clock = 0
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const publisher = new MemoryPublisher()
  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy, now: () => clock })
  runtime.addPersonas(PERSONAS)
  await runtime.bootstrap(undefined, [])
  runtime.watchOnly()
  const addr = (id: string) => wallets.address(PERSONAS.findIndex((p) => p.id === id))
  const newEngine = (extra: Partial<ConstructorParameters<typeof SectorEngine>[0]> = {}) => new SectorEngine({ chain, wallets, publisher, runtime, references: loadReferences(), rules: RULES, ...extra })
  const round = async (engine?: SectorEngine) => {
    await runtime.step()
    await engine?.step()
    chain.mine(3)
    clock += 10_000
    await engine?.idle()
  }
  return { chain, runtime, publisher, addr, newEngine, round }
}

const listed = (chain: FakeChain) => chain.log.filter((e) => e.eventName === "LotListed").map((e) => e.args as EventArgs<"LotListed">)

describe("degradation", () => {
  it("the LLM dies mid-auction: agents keep bidding by rules and the lot still sells", async () => {
    let calls = 0
    const fake = new FakeAi().on("bidder", (i) => {
      if (++calls > 2) throw new Error("connection refused")
      const clearing = i.prompt.match(/clearing ([\d.]+)/)?.[1] ?? "7.50"
      return { action: "bid", maxPerUnit: (Number(clearing) + 0.3).toFixed(2), reason: "LLM bid while it lasted" }
    })
    const strategy = createLlmStrategy({ ai: createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake }), cacheBlocks: 0n })
    const t = await town(strategy)
    const ingrid = t.addr("ingrid")
    const { lotId } = await t.chain.createLot(ingrid, codSpec(ingrid))
    for (let i = 0; i < 16; i++) await t.round()
    const s = strategy.stats()
    expect(s.firstTry).toBe(2)
    expect(s.fallbacks.mock_error).toBeGreaterThan(0)
    expect(t.runtime.log.filter((d) => d.result.status === "failed")).toEqual([])
    const reasons = t.publisher.sent.flatMap((e) => (e.event.type === "agent.intent" && e.event.action === "bid" ? [e.event.reason] : []))
    expect(reasons).toContain("LLM bid while it lasted")
    expect(reasons.some((r) => r.includes("bidding €"))).toBe(true) // rule strategy took over
    expect((await t.chain.getLot(lotId)).status).toBe("sold")
  })

  it("Arkiv errors: the ledger retries, counts what failed, and keeps writing later events", async () => {
    const t = await town()
    const mem = new MemoryArkivStore()
    let failNext = 1
    let alwaysFail = false
    const flaky: ArkivStore = new Proxy(mem, {
      get(target, prop, recv) {
        if (prop !== "put") return Reflect.get(target, prop, recv)
        return async (...a: Parameters<ArkivStore["put"]>) => {
          if (alwaysFail || failNext-- > 0) throw new Error("rabdi timeout")
          return target.put(...a)
        }
      },
    })
    const errors: string[] = []
    const ledger = new LedgerWriter({ chain: t.chain, arkiv: flaky, writer: "0x00000000000000000000000000000000000000ee", retryDelaysMs: [1, 1], onError: (_e, ev) => errors.push(ev) })
    ledger.start()
    const ingrid = t.addr("ingrid")
    await t.chain.createLot(ingrid, codSpec(ingrid))
    await ledger.idle()
    expect(ledger.written.lot).toBe(1)
    expect(ledger.retried.lot).toBe(1)
    alwaysFail = true
    await t.chain.createLot(ingrid, codSpec(ingrid, { commodity: "haddock" }))
    await ledger.idle()
    expect(ledger.failed.lot).toBe(1)
    expect(errors).toEqual(["LotListed"])
    alwaysFail = false
    await t.chain.createLot(ingrid, codSpec(ingrid, { qty: 100n }))
    await ledger.idle()
    expect(ledger.written.lot).toBe(2)
    expect(ledger.pending).toBe(0)
  })
})

describe("idempotent restart", () => {
  it("a new engine replaying history mid-chain books no second truck and finishes the Bergen chain", async () => {
    const t = await town()
    const a = t.newEngine()
    const stopA = a.watchOnly()
    const ingrid = t.addr("ingrid")
    const { lotId } = await t.chain.createLot(ingrid, codSpec(ingrid))
    for (let i = 0; i < 40 && !listed(t.chain).some((l) => l.parentLotId === lotId); i++) await t.round(a)
    expect(listed(t.chain).filter((l) => l.parentLotId === lotId)).toHaveLength(1)
    stopA() // the service dies here

    // Restart: replay everything so far, then go live.
    const head = t.chain.currentBlock
    const b = t.newEngine({ replayUntil: head, caughtUpTo: () => head })
    for (const e of t.chain.log) b.handle(e)
    b.watchOnly()
    await b.idle()
    expect(b.replaying()).toBe(true)
    for (let i = 0; i < 50; i++) await t.round(b)
    expect(b.replaying()).toBe(false)
    expect(listed(t.chain).filter((l) => l.parentLotId === lotId)).toHaveLength(1)
    expect((await t.chain.getLot(lotId)).status).toBe("paid_in_full")
    expect(b.trucks.find((x) => x.id === "lars")!.busy).toBe(false)
  })

  it("replaying a finished day changes nothing on chain", async () => {
    const t = await town()
    const a = t.newEngine()
    const stopA = a.watchOnly()
    const amina = t.addr("amina")
    await t.chain.createLot(amina, codSpec(amina, { sector: "produce", market: "harvest_hall", commodity: "tomato", grade: "class_1", place: "lagos", currency: "USD", qty: 3000n, floorPerUnit: 400_000n, durationBlocks: 90n }))
    for (let i = 0; i < 70; i++) await t.round(a)
    stopA()
    const before = t.chain.log.length
    const head = t.chain.currentBlock
    const b = t.newEngine({ replayUntil: head, caughtUpTo: () => head })
    for (const e of t.chain.log) b.handle(e)
    await b.idle()
    await b.step()
    await b.step()
    const writes = t.chain.log.slice(before).filter((e) => !["SellerRecordUpdated"].includes(e.eventName))
    expect(writes.map((e) => e.eventName)).toEqual([])
  })

  it("the chain feed replays history to late subscribers and reports when it has caught up", () => {
    let emit: (e: ChainEvent) => void = () => {}
    let idle: (h: bigint) => void = () => {}
    const feed = new ChainFeed({ watch: (h, _from, onIdle) => ((emit = h), (idle = onIdle!), () => {}) }, 100n)
    feed.start()
    const ev = { eventName: "LotPaidInFull", args: { lotId: 1n }, address: "0x01", blockNumber: 120n, transactionHash: "0x02", logIndex: 0 } as unknown as ChainEvent
    emit(ev)
    expect(feed.caughtUpTo).toBeUndefined()
    idle(150n)
    const seen: ChainEvent[] = []
    feed.watch((e) => seen.push(e))
    emit({ ...ev, blockNumber: 151n } as ChainEvent)
    expect(seen.map((e) => e.blockNumber)).toEqual([120n, 151n])
    expect(feed.caughtUpTo).toBe(150n)
  })
})

describe("/api/health", () => {
  const base = async (extra: Parameters<typeof healthExtras>[0], chainOk = true) => {
    const t = await town()
    const chain = chainOk ? t.chain : new Proxy(t.chain, { get: (o, p, r) => (p === "blockNumber" ? async () => { throw new Error("rpc down") } : Reflect.get(o, p, r)) })
    const app = buildApp({ config: parseConfig({}), chain, arkiv: new MemoryArkivStore(), ai: { health: async () => ({ ok: true, detail: "mock" }) }, health: healthExtras(extra), logger: false })
    const body = (await app.inject({ method: "GET", url: "/api/health" })).json()
    await app.close()
    return body
  }
  const relayUp = (async () => new Response(JSON.stringify({ ok: true, clients: 2, block: 7 }))) as typeof fetch
  const relayDown = (async () => { throw new Error("ECONNREFUSED") }) as typeof fetch

  it("is ok when everything answers", async () => {
    const h = await base({ relayUrl: "http://relay", llmOn: false, fetch: relayUp, runtime: { agents: new Map([["0x1" as `0x${string}`, { manual: false, paused: false } as never]]) } })
    expect(h).toMatchObject({ ok: true, status: "ok", degraded: [], relay: { ok: true, detail: "2 town clients, block 7" } })
  })

  it("is degraded, not down, when the relay or Arkiv writes fail", async () => {
    const h = await base({ relayUrl: "http://relay", llmOn: false, fetch: relayDown, ledger: { written: { lot: 3 }, failed: { price: 1 }, retried: {}, pending: 0 }, runtime: { agents: new Map([["0x1" as `0x${string}`, {} as never]]) } })
    expect(h.status).toBe("degraded")
    expect(h.degraded).toEqual(["relay", "ledger"])
    expect(h.ledger.detail).toContain("1 failed (chain stays the truth for money)")
  })

  it("is down when the chain is unreachable", async () => {
    const h = await base({ relayUrl: "http://relay", llmOn: false, fetch: relayUp, runtime: { agents: new Map([["0x1" as `0x${string}`, {} as never]]) } }, false)
    expect(h.status).toBe("down")
    expect(h.ok).toBe(false)
  })
})

describe("ledger replay", () => {
  it("replaying a whole day of chain events into Arkiv writes nothing twice", async () => {
    const t = await town()
    const arkiv = new MemoryArkivStore()
    const ledger = new LedgerWriter({ chain: t.chain, arkiv, writer: "0x00000000000000000000000000000000000000ee", retryDelaysMs: [] })
    ledger.start()
    const engine = t.newEngine()
    engine.watchOnly()
    const ingrid = t.addr("ingrid")
    await t.chain.createLot(ingrid, codSpec(ingrid))
    t.chain.pushSignal({ kind: "weather", place: "bergen", severity: 3, expiresAtBlock: 5000n, label: "Storm" })
    for (let i = 0; i < 50; i++) await t.round(engine)
    await ledger.idle()
    const count = async () => {
      const out: Record<string, number> = {}
      for (const [name, schema] of Object.entries((await import("@fairtown/shared/arkiv")).ARKIV_SCHEMAS)) out[name] = (await arkiv.query(schema, {}, { limit: 100 })).entities.length
      return out
    }
    const before = await count()
    expect(before.bid).toBeGreaterThan(0)
    expect(before.reputation).toBeGreaterThan(0)
    expect(before.signal).toBe(1)
    const replay = new LedgerWriter({ chain: t.chain, arkiv, writer: "0x00000000000000000000000000000000000000ee", retryDelaysMs: [] })
    for (const e of t.chain.log) replay.enqueue(e)
    await replay.idle()
    expect(await count()).toEqual(before)
  })
})
