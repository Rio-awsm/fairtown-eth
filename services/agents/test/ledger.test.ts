import { UNIT, toBase } from "@fairtown/shared"
import { ARKIV_SCHEMAS as S } from "@fairtown/shared/arkiv"
import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { LedgerWriter } from "../src/arkiv/ledgerWriter"
import { PERSONAS } from "../src/fixtures/personas"
import { codSpec, world } from "./helpers"

const WRITER = "0x00000000000000000000000000000000000000ee" as Address

async function bergen(opts: { walkinHanse?: boolean } = {}) {
  const w = world()
  const arkiv = new MemoryArkivStore()
  const errors: string[] = []
  const ledger = new LedgerWriter({
    chain: w.chain,
    arkiv,
    writer: WRITER,
    detailsFor: (uri) => ({ grade: "fresh_a", photos: ["0xabc"], uri }),
    hasArkivFunds: () => !opts.walkinHanse,
    onError: (e, ev) => errors.push(`${ev}: ${String(e)}`),
    now: () => new Date("2026-11-07T05:00:00Z"),
  })
  ledger.start()
  const ingrid = await w.agent("SELLER")
  const hanse = await w.agent("BUYER", { EUR: "10000" })
  const { lotId, auction } = await w.chain.createLot(ingrid, codSpec(ingrid))
  await w.bid(hanse, lotId, auction, "9.10", "5460")
  w.chain.mine(45)
  await ledger.idle()
  return { ...w, arkiv, ledger, errors, ingrid, hanse, lotId }
}

describe("ledger writer", () => {
  it("mirrors a Bergen lot: lot by seller, bid by buyer, price and reputation by writer", async () => {
    const { arkiv, ingrid, hanse, lotId, errors, ledger, chain } = await bergen()
    const lot = (await arkiv.query(S.lot, { lotId })).entities[0]!
    expect(lot.owner).toBe(ingrid)
    expect(lot.values).toMatchObject({ commodity: "cod", sector: "fish", market: "fish_dock", place: "bergen", currency: "EUR", status: "sold", grade: "fresh_a" })
    expect(JSON.parse(new TextDecoder().decode(lot.values.details as Uint8Array))).toMatchObject({ photos: ["0xabc"] })
    const bid = (await arkiv.query(S.bid, { lotId })).entities[0]!
    expect(bid.owner).toBe(hanse)
    expect(bid.values.agent).toBe(hanse)
    // On-chain price is the bid rounded up to the auction tick (about 1% of the floor).
    expect((bid.values.maxPerUnit as bigint) >= toBase("9.10") && (bid.values.maxPerUnit as bigint) < toBase("9.18")).toBe(true)
    const price = (await arkiv.query(S.price, { commodity: "cod", day: "2026-11-07" })).entities[0]!
    expect(price.owner).toBe(WRITER)
    expect(price.values).toMatchObject({ lotId, avgPerUnit: toBase("9.10"), soldUnits: 600n })

    const ticket = await chain.signTicket(ingrid, { lotId, buyer: hanse, tokenAmount: 600n * UNIT, expiryBlock: chain.currentBlock + 100n })
    await chain.confirmHandover(hanse, ticket)
    await ledger.idle()
    expect((await arkiv.query(S.lot, { lotId })).entities[0]!.values.status).toBe("paid_in_full")
    const rep = (await arkiv.query(S.reputation, { seller: ingrid })).entities[0]!
    expect(rep.values).toMatchObject({ tier: "new", cleanLots: 1n, noShows: 0n })
    expect(errors).toEqual([])
    expect(ledger.written).toMatchObject({ lot: 5, bid: 1, price: 1, reputation: 1 })
  })

  it("lets the writer write bids for walk-ins without Arkiv funds", async () => {
    const { arkiv, lotId, hanse } = await bergen({ walkinHanse: true })
    const bid = (await arkiv.query(S.bid, { lotId })).entities[0]!
    expect(bid.owner).toBe(WRITER)
    expect(bid.values.agent).toBe(hanse)
  })

  it("writes capacity for truck lots, signals, relists and a no-show refund", async () => {
    const { arkiv, chain, agent, ledger, lotId, hanse } = await bergen()
    const lars = await agent("TRUCK")
    const t = await chain.createLot(lars, codSpec(lars, { sector: "truck", market: "freight_yard", commodity: "truck_capacity", place: "bergen", parentLotId: lotId, floorPerUnit: toBase("0.80") }))
    chain.pushSignal({ kind: "weather", place: "bergen", severity: 3, expiresAtBlock: chain.currentBlock + 500n, label: "Storm (forced)" })
    chain.mine(Number(1n + 45n + 300n - chain.currentBlock) + 1)
    await chain.reportNoShow(hanse, lotId, 600n * UNIT)
    chain.mine(61)
    await ledger.idle()
    expect((await arkiv.query(S.capacity, { lotId: t.lotId })).entities[0]!.values).toMatchObject({ kind: "truck", qty: 600n, fromMarket: "freight_yard" })
    expect((await arkiv.query(S.signal, { place: "bergen" })).entities[0]!.values).toMatchObject({ kind: "weather", severity: 3n })
    expect((await arkiv.query(S.lot, { lotId })).entities[0]!.values.status).toBe("refunded")
    expect((await arkiv.query(S.reputation, { noShows: 1n })).entities).toHaveLength(1)
  })

  it("writes agent profiles idempotently", async () => {
    const { ledger, arkiv } = await bergen()
    const p = PERSONAS[0]!
    await ledger.writeAgent(p, p.fixtureAgentId as Address)
    await ledger.writeAgent(p, p.fixtureAgentId as Address)
    expect((await arkiv.query(S.agent, { name: p.name })).entities).toHaveLength(1)
  })

  it("keeps going when an Arkiv write fails", async () => {
    const w = world()
    const errors: string[] = []
    const broken = new MemoryArkivStore()
    broken.put = async () => {
      throw new Error("rabdi down")
    }
    const ledger = new LedgerWriter({ chain: w.chain, arkiv: broken, writer: WRITER, onError: (e, ev) => errors.push(`${ev}: ${(e as Error).message}`) })
    ledger.start()
    const s = await w.agent("SELLER")
    await w.chain.createLot(s, codSpec(s))
    w.chain.mine(45)
    await ledger.idle()
    expect(errors).toEqual(["LotListed: rabdi down"])
  })
})
