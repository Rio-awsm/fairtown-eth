import { UNIT, toBase, type TownEnvelope } from "@fairtown/shared"
import { TownEnvelope as Envelope } from "@fairtown/shared/protocol"
import type { Hex } from "viem"
import { describe, expect, it } from "vitest"
import { ChainMapper, type RawChainEvent } from "../src/mapping"
import { buildRelay } from "../src/server"
import { RelayState } from "../src/state"
// Test-only: drive the agents service's FakeChain, whose logs have the same shape as the real contracts' decoded logs.
import { codSpec, world } from "../../agents/test/helpers"

const EVIDENCE = `0x${"ab".repeat(32)}` as Hex
const CHAIN_TYPES = [
  "lot.listed", "bid.placed", "price.tick", "lot.settled", "lot.relisted", "transport.needed", "storage.needed", "carrier.assigned",
  "handover.confirmed", "lot.paid_in_full", "lot.delivered", "noshow.reported", "noshow.contested", "noshow.refunded",
  "seller.record", "dispute.opened", "dispute.resolved", "signal", "reference.updated", "fx.updated",
]

// Every section 7 event at least once: truck chain to paid in full, relist, storage, contested and uncontested no-shows,
// a quality dispute, signals, reference and FX.
async function scenario() {
  const w = world()
  const ingrid = await w.agent("SELLER")
  const coastal = await w.agent("SELLER")
  const lars = await w.agent("TRUCK")
  const hanse = await w.agent("BUYER", { EUR: "100000" })
  const fjord = await w.agent("BUYER", { EUR: "100000" })
  const c = w.chain
  const cod = await c.createLot(ingrid, codSpec(ingrid))
  await w.bid(hanse, cod.lotId, cod.auction, "9.10", "5460")
  const empty = await c.createLot(ingrid, codSpec(ingrid, { commodity: "haddock" }))
  c.mine(45)
  await c.relist(ingrid, empty.lotId, toBase("6.00"), 45n)
  await c.requestStorage(hanse, cod.lotId, 100n, 3)
  const truck = await c.createLot(lars, codSpec(lars, { sector: "truck", market: "freight_yard", commodity: "truck_capacity", floorPerUnit: toBase("0.80"), durationBlocks: 30n, parentLotId: cod.lotId }))
  await w.bid(hanse, truck.lotId, truck.auction, "0.85", "510")
  c.mine(30)
  const exp = c.currentBlock + 150n
  await c.confirmHandover(lars, await c.signTicket(ingrid, { lotId: cod.lotId, buyer: hanse, tokenAmount: 600n * UNIT, expiryBlock: exp }))
  await c.confirmHandover(hanse, await c.signTicket(lars, { lotId: truck.lotId, buyer: hanse, tokenAmount: 600n * UNIT, expiryBlock: exp }))

  const a = await c.createLot(coastal, codSpec(coastal))
  await w.bid(fjord, a.lotId, a.auction, "9.10", "5460")
  const b = await c.createLot(coastal, codSpec(coastal))
  await w.bid(hanse, b.lotId, b.auction, "9.10", "5460")
  const q = await c.createLot(ingrid, codSpec(ingrid))
  await w.bid(fjord, q.lotId, q.auction, "9.10", "5460")
  c.mine(46)
  const { disputeId: quality } = await c.openDispute(fjord, q.lotId, 600n * UNIT, EVIDENCE, "ipfs://q")
  c.resolveRuling(quality, 2500)
  c.mine(301)
  await c.reportNoShow(fjord, a.lotId, 600n * UNIT)
  await c.reportNoShow(hanse, b.lotId, 600n * UNIT)
  const { disputeId } = await c.contestNoShow(coastal, b.lotId, hanse, EVIDENCE, "ipfs://x")
  c.mine(61)
  c.resolveRuling(disputeId, 0)
  c.pushSignal({ kind: "weather", place: "bergen", severity: 3, expiresAtBlock: c.currentBlock + 900n, label: "Storm (forced)" })
  c.pushReference("cod", "bergen", toBase("8.30"), "EUR", "rafisklaget")
  c.pushFx("NOK", 1_090_000_000n)
  return c.log
}

const mapper = () =>
  new ChainMapper({
    currencyOf: (a) => ({ "0xc000000000000000000000000000000000000002": "EUR", "0xc000000000000000000000000000000000000001": "USD" })[a] ?? a,
    nameOf: () => "Ingrid Solheim",
    gradeOf: async () => "fresh_a",
    now: () => 1_800_000_000_000,
  })

describe("chain event mapping", () => {
  it("maps every contract event to a valid town event and covers every chain-derived type", async () => {
    const log = await scenario()
    const m = mapper()
    const out: TownEnvelope[] = []
    for (const e of log) out.push(...(await m.map(e as unknown as RawChainEvent)))
    for (const env of out) Envelope.parse(env)
    const seen = new Set(out.map((e) => e.event.type))
    expect(CHAIN_TYPES.filter((t) => !seen.has(t as never))).toEqual([])
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length)
    expect(out.every((e) => e.source === "chain")).toBe(true)
  })

  it("maps the Bergen lot with exact money and names", async () => {
    const log = await scenario()
    const m = mapper()
    const out: TownEnvelope[] = []
    for (const e of log) out.push(...(await m.map(e as unknown as RawChainEvent)))
    const listed = out.find((e) => e.event.type === "lot.listed")!.event
    expect(listed).toMatchObject({ lotId: "1", building: "fish_dock", sector: "fish", commodity: "cod", qty: 600, unit: "kg", currency: "EUR", place: "bergen", floorPerUnit: "7500000", sellerName: "Ingrid Solheim", grade: "fresh_a", parentLotId: "0" })
    const settled = out.find((e) => e.event.type === "lot.settled" && e.event.lotId === "1")!.event
    expect(settled).toMatchObject({ avgPerUnit: "9100000", soldUnits: "600", sellerPaid: "2702700000", held: "2702700000", fee: "54600000", advanceBps: 5000 })
    const delivered = out.find((e) => e.event.type === "lot.delivered")!.event
    expect(delivered).toEqual({ type: "lot.delivered", lotId: "1", truckLotId: "4" })
    expect(out.find((e) => e.event.type === "fx.updated")!.event).toEqual({ type: "fx.updated", currency: "NOK", perUsd: 10.9 })
  })

  it("only ticks when the clearing price changes and ignores logs it has no lot for", async () => {
    const m = mapper()
    expect(m.tick(1n, 7_500_000n)).toBeDefined()
    expect(m.tick(1n, 7_500_000n)).toBeUndefined()
    expect(m.tick(1n, 7_600_000n)!.event).toEqual({ type: "price.tick", lotId: "1", clearingPerUnit: "7600000" })
    const stray = { eventName: "BidSubmitted", args: { id: "1", owner: "0xab", priceQ96: "1", amount: "1" }, address: "0xdead", blockNumber: "5", transactionHash: "0x1", logIndex: 0 }
    expect(await m.map(stray)).toEqual([])
    expect(await m.map({ ...stray, eventName: "AgentRegistered" })).toEqual([])
  })
})

describe("fake chain bridge", () => {
  it("maps forwarded FakeChain logs (bigints as strings) into the snapshot, behind the token", async () => {
    const state = new RelayState()
    const relay = buildRelay({ state, token: "t", logger: false, mapper: mapper() })
    const log = await scenario()
    const body = JSON.parse(JSON.stringify(log, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))
    expect((await relay.app.inject({ method: "POST", url: "/internal/chain", payload: body })).statusCode).toBe(401)
    const r = await relay.app.inject({ method: "POST", url: "/internal/chain", payload: body, headers: { authorization: "Bearer t" } })
    expect(r.statusCode).toBe(200)
    expect(r.json().accepted).toBeGreaterThan(30)
    const lots = state.snapshot().lots
    expect(lots.find((l) => l.lotId === "1")!.status).toBe("paid_in_full")
    expect(lots.find((l) => l.lotId === "2")!.status).toBe("relisted")
    const noBridge = buildRelay({ state: new RelayState(), token: "t", logger: false })
    expect((await noBridge.app.inject({ method: "POST", url: "/internal/chain", payload: [], headers: { authorization: "Bearer t" } })).statusCode).toBe(409)
    await relay.app.close()
    await noBridge.app.close()
  })
})
