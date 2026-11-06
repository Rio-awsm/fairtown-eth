import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { FakeChain } from "../src/chain/fake/FakeChain"
import type { EventArgs } from "../src/chain/types"
import { parseConfig } from "../src/config"
import { Director, fakeSignals } from "../src/director/director"
import { SCENE_NAMES, type ScenarioName } from "../src/director/scenes"
import { PERSONAS } from "../src/fixtures/personas"
import { loadCalendar } from "../src/humans/routes"
import { findReference, loadReferences } from "../src/listing/references"
import { MarketState } from "../src/market/state"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import { Wallets } from "../src/runtime/wallets"
import { SectorEngine } from "../src/sectors/engine"
import { AUCTION_BLOCKS_FAKE } from "../src/sectors/rules"
import { buildApp } from "../src/server"
import { ruleStrategy } from "../src/strategies/rule"
import { recordDay } from "../src/load/record"
import { params } from "./helpers"

const RULES = {
  auctionBlocks: AUCTION_BLOCKS_FAKE,
  pickupBlocks: { fish: 200n, flowers: 200n, produce: 200n, truck: 200n, storage: 100n, compute: 60n },
  arriveBlocks: 5n,
  travelBlocks: 10n,
}

async function town() {
  let clock = 0
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const publisher = new MemoryPublisher()
  const references = loadReferences()
  const market = new MarketState({ chain, references })
  market.start()
  const runtime = new AgentRuntime({
    chain,
    wallets,
    publisher,
    strategy: ruleStrategy,
    now: () => clock,
    markProven: (a) => chain.markProven(a, true),
    marketFor: (lot, block) => {
      const r = findReference(references, lot.commodity, lot.place)
      return { ...(r && r.currency === lot.currency ? { reference: BigInt(r.perUnit) } : {}), signals: market.signalsFor(lot.place, lot.sector, block), urgencyBps: market.urgencyBps(lot.place, lot.sector, block) }
    },
  })
  runtime.addPersonas(PERSONAS)
  await runtime.bootstrap(undefined, ["pedro", "maya"])
  const engine = new SectorEngine({ chain, wallets, publisher, runtime, references, rules: RULES })
  runtime.watchOnly()
  engine.watchOnly()
  const director = new Director({ chain, engine, signals: fakeSignals(chain), signalBlocks: 300n, festivals: loadCalendar().events, today: () => new Date("2026-11-06T09:00:00Z") })
  const run = async (rounds: number, blocks = 3) => {
    for (let i = 0; i < rounds; i++) {
      await director.step()
      await runtime.step()
      await engine.step()
      chain.mine(blocks)
      clock += 10_000
      await engine.idle()
    }
  }
  const events = <N extends Parameters<typeof chain.log.filter>[0] extends never ? never : string>(name: N) => chain.log.filter((e) => e.eventName === name).map((e) => e.args) as unknown[]
  const listedBy = (id: string) => chain.log.filter((e) => e.eventName === "LotListed" && (e.args as EventArgs<"LotListed">).seller === wallets.address(PERSONAS.findIndex((p) => p.id === id))).map((e) => (e.args as EventArgs<"LotListed">).lotId)
  const signals = () => chain.log.filter((e) => e.eventName === "DemandSignal").map((e) => (e.args as EventArgs<"DemandSignal">).label)
  return { chain, runtime, engine, director, run, events, listedBy, signals }
}

const status = async (t: Awaited<ReturnType<typeof town>>, lotId: bigint) => (await t.chain.getLot(lotId)).status

describe("director scenes on FakeChain", () => {
  it("bergen_cod: forced storm, cod sells, truck chained, paid in full", async () => {
    const t = await town()
    expect(await t.director.start("bergen_cod")).toEqual({ started: true })
    await t.run(50)
    expect(t.signals()).toEqual(["Storm forecast, Bergen (forced)"])
    const [cod] = t.listedBy("ingrid")
    expect(await status(t, cod!)).toBe("paid_in_full")
    expect(t.listedBy("lars")).toHaveLength(1)
    expect(t.director.log.every((l) => l.ok)).toBe(true)
  })

  it("dallas_return and gpu_night end paid in full", async () => {
    const t = await town()
    await t.director.start("dallas_return")
    await t.director.start("gpu_night")
    await t.run(30)
    expect(await status(t, t.listedBy("maya")[0]!)).toBe("paid_in_full")
    expect(await status(t, t.listedBy("northlight")[0]!)).toBe("paid_in_full")
  })

  it("diwali_marigold: calendar signal (not forced, the date is real), marigolds sell and are collected", async () => {
    const t = await town()
    await t.director.start("diwali_marigold")
    await t.run(40)
    expect(t.signals()).toEqual(["Diwali in 2 days"])
    expect(await status(t, t.listedBy("ganesh")[0]!)).toBe("paid_in_full")
  })

  it("rose_flight: forced Valentine's signal, roses fly on a chained cargo slot", async () => {
    const t = await town()
    await t.director.start("rose_flight")
    await t.run(50)
    expect(t.signals()).toEqual(["Valentine's cargo cutoff (forced)"])
    const [roses] = t.listedBy("wanjiru")
    expect(t.listedBy("nairobi_air_cargo")).toHaveLength(1)
    expect(await status(t, roses!)).toBe("paid_in_full")
  })

  it("lagos_cold: forced glut, tomatoes sell, cold storage and a truck are booked", async () => {
    const t = await town()
    await t.director.start("lagos_cold")
    await t.run(70)
    expect(t.signals()).toEqual(["Glut at Mile 12 (forced)"])
    const [tomatoes] = t.listedBy("amina")
    expect(t.listedBy("lagos_cold_hub")).toHaveLength(1)
    expect(t.listedBy("kofi")).toHaveLength(1)
    expect(await status(t, tomatoes!)).toBe("paid_in_full")
  })

  it("no_show: Coastal Catch never hands over and buyers are refunded", async () => {
    const t = await town()
    await t.director.start("no_show")
    await t.run(110)
    expect(await status(t, t.listedBy("coastal_catch")[0]!)).toBe("refunded")
  })

  it("full_day runs every scene in order at speed 4, and every director signal is forced or calendar-true", async () => {
    const t = await town()
    await t.director.start("full_day", 4)
    await t.run(140)
    for (const id of ["ingrid", "maya", "northlight", "ganesh", "wanjiru", "amina", "coastal_catch"]) expect(t.listedBy(id).length).toBeGreaterThan(0)
    expect(t.director.log.map((l) => l.scenario)).toEqual(Array(t.director.log.length).fill("full_day"))
    expect(t.director.log.filter((l) => l.ok)).toHaveLength(SCENE_NAMES.reduce((n, s) => n + (s === "dallas_return" || s === "gpu_night" || s === "no_show" ? 1 : 2), 0))
    for (const label of t.signals()) expect(label.endsWith("(forced)") || /^Diwali (today|in \d+ days?)$/.test(label)).toBe(true)
  })
})

describe("director routes", () => {
  it("starts a scene, refuses a duplicate or a bad name, and reports status", async () => {
    const t = await town()
    const app = buildApp({ config: parseConfig({}), chain: t.chain, arkiv: new MemoryArkivStore(), ai: { health: async () => ({ ok: true, detail: "mock" }) }, director: t.director, logger: false })
    const post = (name: ScenarioName | string, speed?: number) => app.inject({ method: "POST", url: "/api/director/scenario", payload: { name, ...(speed !== undefined ? { speed } : {}) } })
    expect((await post("bergen_cod")).json()).toEqual({ started: true })
    expect((await post("bergen_cod")).statusCode).toBe(409)
    expect((await post("moon_landing")).statusCode).toBe(400)
    expect((await post("gpu_night", 0)).statusCode).toBe(400) // speed must be positive
    expect((await post("dallas_return")).statusCode).toBe(200) // one step: done at once, not counted as running
    await post("diwali_marigold")
    await post("rose_flight")
    expect((await post("lagos_cold")).json().error.code).toBe("not_started") // three already running
    const s = (await app.inject({ method: "GET", url: "/api/director/status" })).json()
    expect(s.scenario).toBeTruthy()
    expect(s.step).toBeTruthy()
    await app.close()
  })
})

describe("recorded day", () => {
  it("records full_day with unique ids, non-decreasing timestamps and an outcome for every lot", async () => {
    const r = await recordDay()
    expect(new Set(r.envelopes.map((e) => e.id)).size).toBe(r.envelopes.length)
    for (let i = 1; i < r.envelopes.length; i++) expect(r.envelopes[i]!.ts).toBeGreaterThanOrEqual(r.envelopes[i - 1]!.ts)
    expect(Object.values(r.lots).every((s) => ["paid_in_full", "refunded", "relisted", "unsold"].includes(s))).toBe(true)
    expect(r.counts["lot.paid_in_full"]).toBeGreaterThanOrEqual(6)
    expect(r.counts["noshow.refunded"]).toBeGreaterThan(0)
    expect(r.envelopes.filter((e) => e.event.type === "signal").map((e) => (e.event as { label: string }).label)).toEqual(
      expect.arrayContaining(["Storm forecast, Bergen (forced)", "Valentine's cargo cutoff (forced)", "Glut at Mile 12 (forced)"]),
    )
  })
})
