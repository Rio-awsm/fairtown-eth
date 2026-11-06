import { toBase } from "@fairtown/shared"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { EnsAgents, mandateSummary, VERIFIED_KEY, VERIFIED_ROLE, type EnsPort } from "../src/addons/ens/agents"
import type { EnsState } from "../src/addons/ens/client"
import { labelFor } from "../src/addons/ens/contracts"
import { FakeChain } from "../src/chain/fake/FakeChain"
import type { ChainEvent } from "../src/chain/types"
import { PERSONAS } from "../src/fixtures/personas"
import { checkBid } from "../src/runtime/guardrails"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import type { Observation, RuntimeAgent } from "../src/runtime/types"
import { Wallets } from "../src/runtime/wallets"
import { ruleStrategy } from "../src/strategies/rule"
import { params } from "./helpers"

const ZERO = "0x0000000000000000000000000000000000000000" as Address
const STATE: EnsState = { parent: "fairtown.eth", resolver: "0x00000000000000000000000000000000000000r1" as Address, registry: "0x00000000000000000000000000000000000000r2" as Address, owner: ZERO, txs: {} }

// In-memory ENSv2: labels -> owner, expiry, roles held by the owner, records by full name.
function fakeEns() {
  const names = new Map<string, { owner: Address; expiry: bigint; roles: bigint }>()
  const records = new Map<string, Record<string, string>>()
  const calls: string[] = []
  let down = false
  const port: EnsPort = {
    async ownerOf(_s, label) {
      return names.get(label)?.owner ?? ZERO
    },
    async registerSub(_s, label, owner, expiry, roles) {
      calls.push(`register ${label}`)
      names.set(label, { owner, expiry, roles })
      return { hash: "0x01", logs: [] }
    },
    async setRecords(_s, name, recs, addr) {
      calls.push(`records ${name}`)
      records.set(name, { ...(records.get(name) ?? {}), ...recs, ...(addr ? { addr } : {}) })
      return { hash: "0x02", logs: [] }
    },
    async revokeRole(_s, label, role) {
      calls.push(`revoke ${label}`)
      const n = names.get(label)!
      n.roles &= ~role
      return { hash: "0x03", logs: [] }
    },
    async text(name, key) {
      if (down) throw new Error("rpc down")
      return records.get(name)?.[key] ?? null
    },
  }
  return { port, names, records, calls, setDown: (v: boolean) => (down = v) }
}

const agent = (over: Partial<RuntimeAgent> = {}): RuntimeAgent => ({
  agentId: "0x00000000000000000000000000000000000000a1" as Address,
  name: "Ingrid Solheim",
  role: "SELLER",
  kind: "seller",
  building: "fish_dock",
  sprite: "fisher",
  currency: "EUR",
  budget: 0n,
  paused: false,
  walletIndex: 0,
  personaId: "ingrid",
  ...over,
})
const record = (seller: Address, noShows: number) =>
  ({ eventName: "SellerRecordUpdated", args: { seller, cleanLots: 0, noShows, proven: false }, address: ZERO, blockNumber: 1n, transactionHash: "0xabc", logIndex: 0 }) as unknown as ChainEvent

describe("ENS labels and records", () => {
  it("makes ENSIP-15-safe labels", () => {
    expect(labelFor("coastal_catch")).toBe("coastal-catch")
    expect(labelFor("Priya <3 1a2b")).toBe("priya-3-1a2b")
    expect(() => labelFor("___")).toThrow()
  })

  it("summarises a mandate in display units", () => {
    expect(mandateSummary({ currency: "EUR", mandate: { commodities: ["cod", "haddock"], maxPerUnit: toBase("9.40").toString(), avoidNoShowSellers: true } })).toBe("cod, haddock up to €9.4 per unit")
  })
})

describe("EnsAgents", () => {
  const t0 = Date.UTC(2026, 10, 6, 12)
  const setup = () => {
    const f = fakeEns()
    const sent: unknown[] = []
    const ens = new EnsAgents({ ens: f.port, state: STATE, personas: PERSONAS, publish: async (e) => void sent.push(...e), now: () => t0 })
    return { f, ens, sent }
  }

  it("registers once, owned by the agent, with role-fitting records and expiry, and announces ensName", async () => {
    const { f, ens, sent } = setup()
    expect(await ens.register(agent())).toBe("ingrid.fairtown.eth")
    expect(await ens.register(agent())).toBe("ingrid.fairtown.eth")
    expect(f.calls).toEqual(["register ingrid", "records ingrid.fairtown.eth"])
    const n = f.names.get("ingrid")!
    expect(n.roles).toBe(VERIFIED_ROLE)
    expect(n.expiry).toBe(BigInt(t0 / 1000) + 365n * 86_400n)
    expect(f.records.get("ingrid.fairtown.eth")).toMatchObject({ "fairtown.role": "SELLER", [VERIFIED_KEY]: "true", "fairtown.reputation": expect.stringContaining("arkiv:fairtown.v1.reputation") })
    expect(sent).toEqual([expect.objectContaining({ type: "agent.spawned", ensName: "ingrid.fairtown.eth" })])
  })

  it("gives buyers no verified role, trucks 3 days and walk-ins 2 hours", async () => {
    const { f, ens } = setup()
    await ens.register(agent({ agentId: "0x00000000000000000000000000000000000000b1" as Address, role: "BUYER", personaId: "hanse_kitchen", mandate: { commodities: ["cod"], maxPerUnit: "9400000", avoidNoShowSellers: true } }))
    await ens.register(agent({ agentId: "0x00000000000000000000000000000000000000c1" as Address, role: "TRUCK", personaId: "lars" }))
    await ens.register(agent({ agentId: "0x00000000000000000000000000000000000000d1" as Address, role: "HUMAN", personaId: undefined, name: "Priya", manual: true }))
    expect(f.names.get("hanse-kitchen")!.roles).toBe(0n)
    expect(f.records.get("hanse-kitchen.fairtown.eth")![VERIFIED_KEY]).toBeUndefined()
    expect(f.records.get("hanse-kitchen.fairtown.eth")!["fairtown.mandate"]).toBe("cod up to €9.4 per unit")
    expect(f.names.get("lars")!.expiry).toBe(BigInt(t0 / 1000) + 3n * 86_400n)
    expect(f.names.get("priya-0000")!.expiry).toBe(BigInt(t0 / 1000) + 7200n)
  })

  it("refuses a name someone else already owns", async () => {
    const { f, ens } = setup()
    f.names.set("ingrid", { owner: "0x00000000000000000000000000000000000000ff" as Address, expiry: 1n, roles: 0n })
    const errors: string[] = []
    const e2 = new EnsAgents({ ens: f.port, state: STATE, personas: PERSONAS, onError: (w) => errors.push(w) })
    expect(await e2.register(agent())).toBeUndefined()
    expect(errors).toEqual(["register ingrid.fairtown.eth"])
  })

  it("revokes the verified role once on a no-show and buyers see it through ENS", async () => {
    const { f, ens } = setup()
    const seller = agent().agentId
    await ens.register(agent())
    expect(await ens.sellerCheck(seller)).toMatchObject({ verified: true })
    ens.onEvent(record(seller, 0))
    ens.onEvent(record(seller, 1))
    ens.onEvent(record(seller, 2))
    await ens.idle()
    expect(f.calls.filter((c) => c.startsWith("revoke"))).toEqual(["revoke ingrid"])
    expect(f.names.get("ingrid")!.roles & VERIFIED_ROLE).toBe(0n)
    expect(await ens.sellerCheck(seller)).toMatchObject({ name: "ingrid.fairtown.eth", verified: false, detail: expect.stringContaining("revoked: 1 no-show") })
  })

  it("keeps the last answer when ENS is down, and has no opinion on unnamed sellers", async () => {
    const { f, ens } = setup()
    const seller = agent().agentId
    await ens.register(agent())
    const first = await ens.sellerCheck(seller)
    f.setDown(true)
    const later = new EnsAgents({ ens: f.port, state: STATE, personas: PERSONAS, cacheMs: 0 })
    expect(await later.sellerCheck(seller)).toBeUndefined()
    expect(first?.verified).toBe(true)
    expect(await ens.sellerCheck("0x00000000000000000000000000000000000000ee" as Address)).toBeUndefined()
  })
})

describe("buyers resolve the seller's name before bidding", () => {
  const obs = (verified: boolean, avoid = true): Observation => ({
    agent: { ...agent({ role: "BUYER", personaId: "hanse_kitchen", currency: "EUR", budget: toBase("20000") }), mandate: { commodities: ["cod"], maxPerUnit: toBase("9.40").toString(), avoidNoShowSellers: avoid } },
    budgetLeft: toBase("20000"),
    exposureOnLot: 0n,
    myBestOnLot: 0n,
    lot: { lotId: 1n, auction: ZERO, sector: "fish", commodity: "cod", grade: "fresh_a", building: "fish_dock", place: "bergen", seller: ZERO, sellerRecord: { cleanLots: 0, noShows: 0, proven: false }, currency: "EUR", qty: 600n, floorPerUnit: toBase("7.50"), clearingPerUnit: toBase("7.50"), tickPerUnit: toBase("0.08"), endBlock: 100n, blocksLeft: 50n, sellerEns: { name: "coastal-catch.fairtown.eth", verified } },
  })

  it("guardrails reject a seller whose ENS verified role is revoked, unless the mandate allows it", () => {
    const d = { action: "bid" as const, maxPerUnit: toBase("8.00").toString(), amount: toBase("800").toString(), reason: "x" }
    expect(checkBid(d, obs(false), [], 0)).toEqual({ ok: false, reason: "coastal-catch.fairtown.eth: verified role revoked" })
    expect(checkBid(d, obs(false, false), [], 0).ok).toBe(true)
    expect(checkBid(d, obs(true), [], 0).ok).toBe(true)
    expect(ruleStrategy.decide(obs(false))).toEqual({ action: "pass", reason: "coastal-catch.fairtown.eth lost its verified mark" })
  })

  it("the runtime asks ENS about the seller and announces agents with their names", async () => {
    const wallets = new Wallets(generateMnemonic(english))
    const chain = new FakeChain({ params, accountFor: wallets.accountFor })
    const publisher = new MemoryPublisher()
    const asked: Address[] = []
    const runtime = new AgentRuntime({
      chain,
      wallets,
      publisher,
      strategy: ruleStrategy,
      sellerCheck: async (s) => (asked.push(s), { name: "ingrid.fairtown.eth", verified: false }),
      ensNameOf: (a) => (a === wallets.address(0) ? "ingrid.fairtown.eth" : undefined),
    })
    runtime.addPersonas(PERSONAS)
    await runtime.bootstrap(undefined, [])
    runtime.watchOnly()
    expect(publisher.sent.find((e) => e.event.type === "agent.spawned" && e.event.agentId === wallets.address(0))?.event).toMatchObject({ ensName: "ingrid.fairtown.eth" })
    const ingrid = wallets.address(0)
    await chain.createLot(ingrid, { sector: "fish", market: "fish_dock", commodity: "cod", grade: "fresh_a", place: "bergen", currency: "EUR", qty: 600n, floorPerUnit: toBase("7.50"), durationBlocks: 45n, pickupWindowBlocks: 300n, parentLotId: 0n, seller: ingrid, metadataURI: "" })
    await runtime.step()
    expect(asked).toContain(ingrid)
    expect(runtime.log.filter((d) => d.result.status === "bid")).toEqual([])
  })
})
