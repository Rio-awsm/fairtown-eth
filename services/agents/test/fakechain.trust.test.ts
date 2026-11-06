import { UNIT, toBase, type HandoverTicket } from "@fairtown/shared"
import type { Hex } from "viem"
import { describe, expect, it } from "vitest"
import { ChainError } from "../src/chain/errors"
import { bergenSingle, codSpec } from "./helpers"

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p)
  } catch (e) {
    return e instanceof ChainError ? e.code : String(e)
  }
  return "no error"
}
const EVIDENCE = `0x${"ab".repeat(32)}` as Hex

describe("FakeChain handover", () => {
  it("runs Scene 1: truck booked, picked up, delivered, paid in full", async () => {
    const w = await bergenSingle()
    const lars = await w.agent("TRUCK")
    const t = await w.chain.createLot(
      lars,
      codSpec(lars, {
        sector: "truck",
        market: "freight_yard",
        commodity: "truck_capacity",
        floorPerUnit: toBase("0.80"),
        durationBlocks: 30n,
        parentLotId: w.lotId,
      }),
    )
    await w.bid(w.hanse, t.lotId, t.auction, "0.85", "510")
    w.chain.mine(30)
    expect(w.last("CarrierAssigned")).toEqual({ lotId: w.lotId, truckLotId: t.lotId, carrier: lars })
    expect((await w.chain.getLot(w.lotId)).status).toBe("truck_booked")

    const expiry = w.chain.currentBlock + 150n
    const pTicket = await w.chain.signTicket(w.ingrid, { lotId: w.lotId, buyer: w.hanse, tokenAmount: 600n * UNIT, expiryBlock: expiry })
    const r1 = await w.chain.confirmHandover(lars, pTicket)
    expect(r1.releasedToSeller).toBe(toBase("2702.70"))
    expect((await w.chain.getLot(w.lotId)).status).toBe("picked_up")
    expect(w.events("LotDelivered")).toHaveLength(0)

    const before = w.chain.log.length
    const tTicket = await w.chain.signTicket(lars, { lotId: t.lotId, buyer: w.hanse, tokenAmount: 600n * UNIT, expiryBlock: expiry })
    await w.chain.confirmHandover(w.hanse, tTicket)
    const names = w.chain.log.slice(before).map((e) => e.eventName)
    expect(names).toEqual(["HandoverConfirmed", "LotDelivered", "SellerRecordUpdated", "LotPaidInFull", "LotPaidInFull"])
    expect(w.last("LotDelivered")).toEqual({ lotId: w.lotId, truckLotId: t.lotId })
    expect((await w.chain.getLot(w.lotId)).status).toBe("paid_in_full")
    expect((await w.chain.getLot(t.lotId)).status).toBe("paid_in_full")

    expect(await w.chain.balanceOf("EUR", w.ingrid)).toBe(toBase("5405.40"))
    expect(await w.chain.balanceOf("EUR", lars)).toBe(toBase("504.90"))
    expect(await w.chain.balanceOf("EUR", w.chain.treasury)).toBe(toBase("59.70"))
    expect(await w.chain.sellerRecord(w.ingrid)).toEqual({ cleanLots: 1, noShows: 0, proven: false })
    expect(await w.chain.sellerRecord(lars)).toEqual({ cleanLots: 1, noShows: 0, proven: false })
    expect(w.chain.totalOf("EUR")).toBe(toBase("20000"))
  })

  it("handles direct pickup and gives dust to the last share", async () => {
    const w = await bergenSingle()
    const exp = w.chain.currentBlock + 150n
    const a = await w.chain.signTicket(w.ingrid, { lotId: w.lotId, buyer: w.hanse, tokenAmount: 200n * UNIT + 1n, expiryBlock: exp })
    const r1 = await w.chain.confirmHandover(w.hanse, a)
    expect(r1.releasedToSeller).toBe((toBase("2702.70") * (200n * UNIT + 1n)) / (600n * UNIT))
    expect(w.last("LotDelivered")).toEqual({ lotId: w.lotId, truckLotId: 0n })
    const rest = 400n * UNIT - 1n
    const b = await w.chain.signTicket(w.ingrid, { lotId: w.lotId, buyer: w.hanse, tokenAmount: rest, expiryBlock: exp })
    const r2 = await w.chain.confirmHandover(w.hanse, b)
    expect(r1.releasedToSeller + r2.releasedToSeller).toBe(toBase("2702.70"))
    expect(w.last("LotPaidInFull")).toEqual({ lotId: w.lotId })
  })

  it("rejects bad tickets without moving money", async () => {
    const w = await bergenSingle()
    const exp = w.chain.currentBlock + 150n
    const msg = { lotId: w.lotId, buyer: w.hanse, tokenAmount: 600n * UNIT, expiryBlock: exp }
    const good = await w.chain.signTicket(w.ingrid, msg)
    const otherSeller = await w.agent("SELLER")
    const wrongSigner = await w.chain.signTicket(otherSeller, msg)
    const tampered: HandoverTicket = { ...good, tokenAmount: 1n }
    const malformed: HandoverTicket = { ...good, sig: `0x${"11".repeat(65)}` }
    const expired = await w.chain.signTicket(w.ingrid, { ...msg, expiryBlock: w.chain.currentBlock - 1n })
    const balance = await w.chain.balanceOf("EUR", w.ingrid)

    expect(await code(w.chain.confirmHandover(w.hanse, wrongSigner))).toBe("BadSignature")
    expect(await code(w.chain.confirmHandover(w.hanse, tampered))).toBe("BadSignature")
    expect(await code(w.chain.confirmHandover(w.hanse, malformed))).toBe("BadSignature")
    expect(await code(w.chain.confirmHandover(w.hanse, expired))).toBe("TicketExpired")
    expect(await code(w.chain.confirmHandover(w.oslo, good))).toBe("NotBuyerOrCarrier")
    expect(await w.chain.balanceOf("EUR", w.ingrid)).toBe(balance)
    await w.chain.confirmHandover(w.hanse, good)
    expect(await code(w.chain.confirmHandover(w.hanse, good))).toBe("TicketUsed")
  })
})

describe("FakeChain no-show and disputes", () => {
  it("refunds an uncontested no-show and marks the seller", async () => {
    const w = await bergenSingle()
    w.chain.markProven(w.ingrid, true)
    const deadline = 1n + 45n + 300n
    w.chain.mine(Number(deadline - w.chain.currentBlock))
    expect(await code(w.chain.reportNoShow(w.hanse, w.lotId, 600n * UNIT))).toBe("TooEarly")
    w.chain.mine(1)
    const { contestEnds } = await w.chain.reportNoShow(w.hanse, w.lotId, 600n * UNIT)
    expect(contestEnds).toBe(w.chain.currentBlock + 60n)
    expect(await code(w.chain.reportNoShow(w.hanse, w.lotId, 1n))).toBe("AlreadyReported")
    w.chain.mine(60)
    expect(w.events("NoShowRefunded")).toHaveLength(0)
    w.chain.mine(1)
    expect(w.last("NoShowRefunded")).toEqual({ lotId: w.lotId, seller: w.ingrid, buyer: w.hanse, refund: toBase("2702.70") })
    expect(await w.chain.balanceOf("EUR", w.hanse)).toBe(toBase("10000") - toBase("5460") + toBase("2702.70"))
    expect(await w.chain.sellerRecord(w.ingrid)).toEqual({ cleanLots: 0, noShows: 1, proven: false })
    expect((await w.chain.getLot(w.lotId)).status).toBe("refunded")
    expect(await w.chain.advanceBpsFor(w.ingrid, "fish")).toBe(5000)
    w.chain.mine(400)
    expect(w.events("HeldReleased")).toHaveLength(0)
    expect(w.chain.totalOf("EUR")).toBe(toBase("20000"))
  })

  it("lets the seller contest and W3 rule for the seller", async () => {
    const w = await bergenSingle()
    w.chain.mine(301)
    await w.chain.reportNoShow(w.hanse, w.lotId, 600n * UNIT)
    expect(await code(w.chain.contestNoShow(w.oslo, w.lotId, w.hanse, EVIDENCE, "ipfs://x"))).toBe("NotSeller")
    const { disputeId } = await w.chain.contestNoShow(w.ingrid, w.lotId, w.hanse, EVIDENCE, "ipfs://x")
    expect(w.last("DisputeOpened")).toMatchObject({ disputeId, kind: 1 })
    expect(w.last("NoShowContested")).toEqual({ lotId: w.lotId, buyer: w.hanse, disputeId })
    w.chain.mine(500)
    expect(w.events("NoShowRefunded")).toHaveLength(0)
    expect(w.events("HeldReleased")).toHaveLength(0)
    w.chain.resolveRuling(disputeId, 0)
    expect(w.last("RulingSettled")).toEqual({ lotId: w.lotId, buyer: w.hanse, refundToBuyer: 0n, paidToSeller: toBase("2702.70") })
    expect((await w.chain.getLot(w.lotId)).status).toBe("paid_in_full")
    expect(await w.chain.sellerRecord(w.ingrid)).toMatchObject({ cleanLots: 1 })
  })

  it("closes the contest window", async () => {
    const w = await bergenSingle()
    w.chain.mine(301)
    await w.chain.reportNoShow(w.hanse, w.lotId, 600n * UNIT)
    w.chain.mine(61)
    expect(await code(w.chain.contestNoShow(w.ingrid, w.lotId, w.hanse, EVIDENCE, "x"))).toBe("AlreadyContested")
  })

  it("releases held to the seller when the buyer stays silent", async () => {
    const w = await bergenSingle()
    w.chain.mine(300 + 300)
    expect(w.events("HeldReleased")).toHaveLength(0)
    w.chain.mine(1)
    expect(w.last("HeldReleased")).toEqual({ lotId: w.lotId, amount: toBase("2702.70") })
    expect(w.last("LotPaidInFull")).toEqual({ lotId: w.lotId })
    expect(await code(w.chain.reportNoShow(w.hanse, w.lotId, 600n * UNIT))).toBe("WindowClosed")
  })

  it("settles a quality dispute at 25% refund", async () => {
    const w = await bergenSingle()
    const { disputeId } = await w.chain.openDispute(w.hanse, w.lotId, 600n * UNIT, EVIDENCE, "ipfs://photos")
    expect(w.last("DisputeOpened")).toMatchObject({ disputeId, kind: 0, tokenAmount: 600n * UNIT })
    expect((await w.chain.getLot(w.lotId)).status).toBe("disputed")
    w.chain.resolveRuling(disputeId, 2500)
    expect(w.last("RulingSettled")).toEqual({
      lotId: w.lotId,
      buyer: w.hanse,
      refundToBuyer: toBase("675.675"),
      paidToSeller: toBase("2027.025"),
    })
    expect((await w.chain.getLot(w.lotId)).status).toBe("refunded")
    expect(await w.chain.sellerRecord(w.ingrid)).toMatchObject({ cleanLots: 0 })
    expect(await code(() => w.chain.resolveRuling(disputeId, 0))).toBe("DisputeNotFound")
    expect(w.chain.totalOf("EUR")).toBe(toBase("20000"))
  })

  it("requests storage only for tokens held", async () => {
    const w = await bergenSingle()
    await w.chain.requestStorage(w.hanse, w.lotId, 600n, 3)
    expect(w.last("StorageNeeded")).toEqual({ lotId: w.lotId, requester: w.hanse, qty: 600n, days_: 3 })
    expect(await code(w.chain.requestStorage(w.hanse, w.lotId, 601n, 3))).toBe("InsufficientTokens")
  })
})
