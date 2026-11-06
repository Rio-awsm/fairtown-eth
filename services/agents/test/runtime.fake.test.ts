import { toBase } from "@fairtown/shared"
import { AgentView } from "@fairtown/shared/api"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { LedgerWriter } from "../src/arkiv/ledgerWriter"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import { Wallets } from "../src/runtime/wallets"
import { buildApp } from "../src/server"
import { ruleStrategy } from "../src/strategies/rule"
import { codSpec, params } from "./helpers"

async function town() {
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const publisher = new MemoryPublisher()
  const arkiv = new MemoryArkivStore()
  const ledger = new LedgerWriter({ chain, arkiv, writer: "0x00000000000000000000000000000000000000ee" })
  const nameOf = (a: Address) => PERSONAS.find((_, i) => wallets.address(i) === a.toLowerCase())?.name
  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy: ruleStrategy, ledger, nameOf, markProven: (a) => chain.markProven(a, true) })
  runtime.addPersonas(PERSONAS)
  ledger.start()
  await runtime.bootstrap(undefined, ["pedro", "maya"])
  runtime.watchOnly()
  const addr = (id: string) => wallets.address(PERSONAS.findIndex((p) => p.id === id))
  const run = async (rounds: number, blocksPerRound = 3) => {
    for (let i = 0; i < rounds; i++) {
      await runtime.step()
      chain.mine(blocksPerRound)
    }
  }
  return { wallets, chain, publisher, arkiv, ledger, runtime, addr, run }
}

describe("agent runtime on FakeChain", () => {
  it("bootstraps every persona idempotently with the right stable, gas and an agent entity", async () => {
    const t = await town()
    expect(t.runtime.agents.size).toBe(27)
    const hanse = t.addr("hanse_kitchen")
    expect(await t.chain.balanceOf("EUR", hanse)).toBe(toBase("20000"))
    expect(await t.chain.balanceOf("USD", t.addr("atlas_labs"))).toBe(toBase("5000"))
    expect(await t.chain.balanceOf("ETH", hanse)).toBe(10n ** 16n)
    expect(await t.chain.advanceBpsFor(t.addr("pedro"), "produce")).toBe(9000)
    await t.runtime.bootstrap(undefined, [])
    expect(await t.chain.balanceOf("EUR", hanse)).toBe(toBase("20000"))
    await t.ledger.idle()
    expect((await t.arkiv.query({ name: "fairtown.v1.agent", indexed: ["role", "name", "building"] }, { role: "BUYER" })).entities).toHaveLength(12)
    expect(t.publisher.sent.filter((e) => e.event.type === "agent.spawned")).toHaveLength(54)
  })

  it("lets EUR fish buyers bid on Bergen cod by rules, inside mandates, and the lot sells", async () => {
    const t = await town()
    const ingrid = t.addr("ingrid")
    const { lotId } = await t.chain.createLot(ingrid, codSpec(ingrid))
    await t.run(16)
    const bids = t.runtime.log.filter((d) => d.result.status === "bid")
    expect(bids.length).toBeGreaterThan(2)
    const bidders = new Set(bids.map((b) => b.agentId))
    expect([...bidders].every((a) => ["hanse_kitchen", "fjord_processing", "oslo_fiskehall"].map(t.addr).includes(a))).toBe(true)
    for (const b of bids) {
      const agent = t.runtime.agents.get(b.agentId)!
      if (b.result.status === "bid") expect(b.result.maxPerUnit <= BigInt(agent.mandate!.maxPerUnit)).toBe(true)
    }
    const lot = await t.chain.getLot(lotId)
    expect(lot.status).toBe("sold")
    expect(lot.settlement!.soldUnits).toBe(600n)
    const intents = t.publisher.sent.filter((e) => e.event.type === "agent.intent" && e.event.action === "bid")
    expect(intents.length).toBe(bids.length)
    const v = t.runtime.view(t.addr("hanse_kitchen"))!
    expect(v.exposure).toBe("0")
    expect(BigInt(v.spent) + BigInt(v.budgetLeft)).toBe(toBase("20000"))
  })

  it("never bids for a USD buyer on a EUR lot, and stops bidding on a seller after a no-show", async () => {
    const t = await town()
    const coastal = t.addr("coastal_catch")
    const first = await t.chain.createLot(coastal, codSpec(coastal, { commodity: "haddock", qty: 400n, floorPerUnit: toBase("6.00") }))
    await t.run(16)
    const holders: Address[] = []
    for (const a of t.runtime.agents.values()) if ((await t.chain.tokenBalance(first.lotId, a.agentId)) > 0n) holders.push(a.agentId)
    expect(holders.length).toBeGreaterThan(0)
    const lot = await t.chain.getLot(first.lotId)
    t.chain.mine(Number(lot.settlement!.pickupDeadline - t.chain.currentBlock) + 1)
    for (const h of holders) await t.chain.reportNoShow(h, first.lotId, await t.chain.tokenBalance(first.lotId, h))
    t.chain.mine(61)
    expect((await t.chain.sellerRecord(coastal)).noShows).toBe(holders.length)

    const before = t.runtime.log.length
    const second = await t.chain.createLot(coastal, codSpec(coastal, { commodity: "haddock", qty: 300n, floorPerUnit: toBase("6.00") }))
    await t.run(3)
    const after = t.runtime.log.slice(before).filter((d) => d.lotId === second.lotId)
    expect(after.every((d) => d.result.status === "pass")).toBe(true)
    expect(after.some((d) => d.result.status === "pass" && d.result.reason.includes("recent no-show"))).toBe(true)
    expect(t.runtime.log.some((d) => d.agentId === t.addr("gulf_produce"))).toBe(false)
  })

  it("serves agents and creates a buyer over REST", async () => {
    const t = await town()
    const ai = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }) })
    const app = buildApp({ config: parseConfig({}), chain: t.chain, arkiv: t.arkiv, ai, runtime: t.runtime, logger: false })
    const all = (await app.inject({ method: "GET", url: "/api/agents" })).json()
    expect(all).toHaveLength(27)
    const one = AgentView.parse((await app.inject({ method: "GET", url: `/api/agents/${t.addr("hanse_kitchen")}` })).json())
    expect(one).toMatchObject({ name: "Hanse Kitchen Group", role: "BUYER", currency: "EUR", budget: "20000000000" })

    const created = await app.inject({
      method: "POST",
      url: "/api/buyers",
      payload: { name: "Judge Asha", role: "BUYER", currency: "USD", budget: "500000000", mandate: { commodities: ["marigold"], maxPerUnit: "1300000" } },
    })
    expect(created.statusCode).toBe(200)
    const { agentId } = created.json()
    expect(await t.chain.balanceOf("USD", agentId)).toBe(toBase("500"))
    const patched = (await app.inject({ method: "PATCH", url: `/api/agents/${agentId}`, payload: { paused: true, mandate: { maxPerUnit: "1200000" } } })).json()
    expect(patched).toMatchObject({ paused: true, mandate: { maxPerUnit: "1200000", commodities: ["marigold"] } })
    expect((await app.inject({ method: "POST", url: "/api/buyers", payload: { name: "x", role: "SELLER", currency: "USD", budget: "1", mandate: { commodities: ["cod"], maxPerUnit: "1" } } })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: "/api/agents/0xnope" })).statusCode).toBe(404)
    await app.close()
  })
})

