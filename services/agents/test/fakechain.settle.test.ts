import { UNIT, toBase, toKey } from "@fairtown/shared"
import { describe, expect, it } from "vitest"
import { ChainError } from "../src/chain/errors"
import { codSpec, world } from "./helpers"

const code = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof ChainError ? e.code : String(e)
  }
  return "no error"
}

describe("FakeChain settlement", () => {
  it("settles Bergen with the exact staged payout", async () => {
    const w = world()
    const ingrid = await w.agent("SELLER")
    const oslo = await w.agent("BUYER", { EUR: "10000" })
    const hanse = await w.agent("BUYER", { EUR: "10000" })
    const fjord = await w.agent("BUYER", { EUR: "10000" })
    const { lotId, auction } = await w.chain.createLot(ingrid, codSpec(ingrid))
    expect(w.last("LotListed")).toMatchObject({ lotId, sector: toKey("fish"), market: toKey("fish_dock"), qty: 600n })

    await w.bid(oslo, lotId, auction, "8.00", "2000")
    await w.bid(hanse, lotId, auction, "9.40", "2730")
    await w.bid(fjord, lotId, auction, "9.10", "2730")
    w.chain.mine(44)
    expect(w.events("LotSettled")).toHaveLength(0)
    w.chain.mine(1)

    expect(w.last("LotSettled")).toEqual({
      lotId,
      finalClearingPerUnit: toBase("9.10"),
      avgPerUnit: toBase("9.10"),
      soldUnits: 600n,
      raised: toBase("5460"),
      sellerPaid: toBase("2702.70"),
      held: toBase("2702.70"),
      fee: toBase("54.60"),
      advanceBps: 5000,
      pickupDeadline: 1n + 45n + 300n,
    })
    expect(await w.chain.balanceOf("EUR", ingrid)).toBe(toBase("2702.70"))
    expect(await w.chain.balanceOf("EUR", oslo)).toBe(toBase("10000"))
    expect(await w.chain.balanceOf("EUR", w.chain.treasury)).toBe(toBase("54.60"))
    expect(await w.chain.tokenBalance(lotId, hanse)).toBe(300n * UNIT)
    expect(await w.chain.tokenBalance(lotId, fjord)).toBe(300n * UNIT)
    expect(w.last("TransportNeeded")).toMatchObject({ lotId, qty: 600n, fromMarket: toKey("fish_dock") })
    expect((await w.chain.getLot(lotId)).status).toBe("sold")
    expect(w.chain.totalOf("EUR")).toBe(toBase("30000"))
  })

  it("pays proven sellers 90% and trucks always 10%", async () => {
    const w = world()
    const ingrid = await w.agent("SELLER")
    const lars = await w.agent("TRUCK")
    const hanse = await w.agent("BUYER", { EUR: "10000" })
    w.chain.markProven(ingrid, true)
    w.chain.markProven(lars, true)
    const a = await w.chain.createLot(ingrid, codSpec(ingrid))
    const t = await w.chain.createLot(
      lars,
      codSpec(lars, { sector: "truck", market: "freight_yard", commodity: "truck_capacity", floorPerUnit: toBase("0.80") }),
    )
    await w.bid(hanse, a.lotId, a.auction, "9.10", "1000")
    await w.bid(hanse, t.lotId, t.auction, "0.85", "100")
    w.chain.mine(45)
    const settled = w.events("LotSettled")
    expect(settled.find((s) => s.lotId === a.lotId)!.advanceBps).toBe(9000)
    expect(settled.find((s) => s.lotId === t.lotId)!.advanceBps).toBe(1000)
    expect(w.events("TransportNeeded").map((e) => e.lotId)).toEqual([a.lotId])
  })

  it("settles an empty auction as unsold and relists lower", async () => {
    const w = world()
    const amina = await w.agent("SELLER")
    const other = await w.agent("SELLER")
    const spec = codSpec(amina, { sector: "produce", market: "harvest_hall", commodity: "tomato", place: "lagos" })
    const { lotId } = await w.chain.createLot(amina, spec)
    w.chain.mine(45)
    expect(w.last("LotSettled")).toMatchObject({ lotId, soldUnits: 0n, raised: 0n })
    expect((await w.chain.getLot(lotId)).status).toBe("unsold")
    expect(w.events("TransportNeeded")).toHaveLength(0)

    expect(await code(w.chain.relist(amina, lotId, toBase("8.00"), 45n))).toBe("FloorNotLower")
    expect(await code(w.chain.relist(other, lotId, toBase("6.00"), 45n))).toBe("NotSeller")
    const { newLotId } = await w.chain.relist(amina, lotId, toBase("6.375"), 45n)
    expect(w.last("LotListed")).toMatchObject({ lotId: newLotId, parentLotId: lotId, qty: 600n, floorPerUnit: toBase("6.375") })
    expect(w.last("LotRelisted")).toEqual({ lotId, newLotId, newFloorPerUnit: toBase("6.375") })
    expect((await w.chain.getLot(lotId)).status).toBe("relisted")
    expect(await code(w.chain.relist(amina, lotId, toBase("5.00"), 45n))).toBe("NothingToRelist")
  })

  it("rejects bad bids", async () => {
    const w = world()
    const ingrid = await w.agent("SELLER", { EUR: "100" })
    const hanse = await w.agent("BUYER", { EUR: "100" })
    const broke = await w.agent("BUYER")
    const fresh = await w.agent("BUYER", { EUR: "100" })
    const { lotId, auction } = await w.chain.createLot(ingrid, codSpec(ingrid))
    expect(await code(w.bid(hanse, lotId, auction, "7.50", "10"))).toBe("BelowClearing")
    expect(await code(w.chain.submitBid(fresh, { lotId, maxPerUnit: toBase("8"), amount: toBase("10") }))).toBe("NoPermit2")
    expect(await code(w.bid(ingrid, lotId, auction, "8", "10"))).toBe("CannotBid")
    expect(await code(w.bid(broke, lotId, auction, "8", "10"))).toBe("InsufficientBalance")
    expect(await code(w.bid(hanse, lotId, auction, "8", "0"))).toBe("BadAmount")
    w.chain.mine(45)
    expect(await code(w.bid(hanse, lotId, auction, "8", "10"))).toBe("AuctionEnded")
    expect(await code(w.bid(hanse, 99n, auction, "8", "10"))).toBe("LotNotFound")
  })

  it("rejects bad listings", async () => {
    const w = world()
    const ingrid = await w.agent("SELLER")
    const hanse = await w.agent("BUYER")
    expect(await code(w.chain.createLot(hanse, codSpec(hanse)))).toBe("CannotList")
    expect(await code(w.chain.createLot(ingrid, codSpec(ingrid, { floorPerUnit: 999n })))).toBe("FloorTooLow")
    expect(await code(w.chain.createLot(ingrid, codSpec(hanse)))).toBe("NotSeller")
    expect(await code(w.chain.createLot(ingrid, codSpec(ingrid, { qty: 0n })))).toBe("BadSpec")
  })

  it("emits clearing updates and oracle events", async () => {
    const w = world()
    const ingrid = await w.agent("SELLER")
    const hanse = await w.agent("BUYER", { EUR: "10000" })
    const { lotId, auction } = await w.chain.createLot(ingrid, codSpec(ingrid))
    await w.bid(hanse, lotId, auction, "9.10", "5460")
    expect(w.last("ClearingPriceUpdated").clearingPriceQ96 > 0n).toBe(true)
    expect(await w.chain.clearingPerUnit(lotId)).toBe(toBase("9.10"))
    w.chain.pushSignal({ kind: "weather", place: "bergen", severity: 3, expiresAtBlock: 500n, label: "Storm (forced)" })
    w.chain.pushFx("NOK", 1_100_000_000n)
    w.chain.pushReference("cod", "bergen", toBase("8.30"), "EUR", "rafisklaget")
    expect(w.last("DemandSignal")).toMatchObject({ id: 1n, signalKind: toKey("weather"), severity: 3 })
    expect(w.last("FxUpdated").perUsdE8).toBe(1_100_000_000n)
    expect(w.last("ReferencePriceUpdated").perUnit).toBe(toBase("8.30"))
  })
})
