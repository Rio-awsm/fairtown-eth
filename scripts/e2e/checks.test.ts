import { describe, expect, it } from "vitest"
import { splitPayout } from "@fairtown/shared/units"
import { CheckError, checkArkivPrice, checkExits, checkSettlement, type Settled, type Transfer } from "./checks"

const TOKEN = "0x00000000000000000000000000000000000000e0"
const SETTLEMENT = "0x0000000000000000000000000000000000000005"
const SELLER = "0x00000000000000000000000000000000000000a1"
const TREASURY = "0x00000000000000000000000000000000000000f1"

const raised = 750_000_000n
const split = splitPayout(raised, 100n, 5000n)
const settled: Settled = {
  lotId: 7n,
  finalClearingPerUnit: 7_500_000n,
  avgPerUnit: 7_500_000n,
  soldUnits: 100n,
  raised,
  sellerPaid: split.advance,
  held: split.held,
  fee: split.fee,
  advanceBps: 5000,
}
const transfers: Transfer[] = [
  { token: TOKEN, from: "0x00000000000000000000000000000000000000c1", to: SETTLEMENT, value: raised },
  { token: TOKEN, from: SETTLEMENT, to: SELLER, value: split.advance },
  { token: TOKEN, from: SETTLEMENT, to: TREASURY, value: split.fee },
]
const ctx = {
  feeBps: 100n,
  expectedAdvanceBps: 5000n,
  heldOnChain: split.held,
  transfers,
  currency: TOKEN,
  settlement: SETTLEMENT,
  seller: SELLER,
  treasury: TREASURY,
}

describe("checkSettlement", () => {
  it("passes on an exact settle", () => {
    expect(checkSettlement(settled, ctx)).toHaveLength(7)
  })

  it("fails when the tier is wrong", () => {
    expect(() => checkSettlement(settled, { ...ctx, expectedAdvanceBps: 9000n })).toThrow(/advance tier/)
  })

  it("fails when the advance is off by one base unit", () => {
    expect(() => checkSettlement({ ...settled, sellerPaid: settled.sellerPaid - 1n }, ctx)).toThrow(CheckError)
  })

  it("fails when the settle tx paid the seller a different amount", () => {
    const short = transfers.map((t) => (t.to === SELLER ? { ...t, value: t.value - 1n } : t))
    expect(() => checkSettlement(settled, { ...ctx, transfers: short })).toThrow(/paid the seller/)
  })

  it("fails when held on chain differs", () => {
    expect(() => checkSettlement(settled, { ...ctx, heldOnChain: 0n })).toThrow(/heldOf/)
  })

  it("fails when nothing sold", () => {
    expect(() => checkSettlement({ ...settled, soldUnits: 0n }, ctx)).toThrow(/sold 0/)
  })
})

describe("checkExits", () => {
  it("passes when every bid exited and every filled bid claimed", () => {
    const exits = [
      { bidId: 1n, tokensFilled: 5n },
      { bidId: 2n, tokensFilled: 0n },
    ]
    expect(checkExits([1n, 2n], exits, [1n])).toHaveLength(3)
  })

  it("fails on a missing exit", () => {
    expect(() => checkExits([1n, 2n], [{ bidId: 1n, tokensFilled: 5n }], [1n])).toThrow(/missing 2/)
  })

  it("fails on a filled bid that was not claimed", () => {
    expect(() => checkExits([1n], [{ bidId: 1n, tokensFilled: 5n }], [])).toThrow(/claimed/)
  })

  it("fails when no bids landed", () => {
    expect(() => checkExits([], [], [])).toThrow(/0 bids/)
  })
})

describe("checkArkivPrice", () => {
  const tx = "0xabc"
  const entity = { lotId: 7n, finalClearingPerUnit: 7_500_000n, avgPerUnit: 7_500_000n, soldUnits: 100n, tx }

  it("passes when the entity matches the settle event", () => {
    expect(checkArkivPrice([entity], settled, "0xABC")).toHaveLength(3)
  })

  it("fails when no entity carries the settle tx", () => {
    expect(() => checkArkivPrice([{ ...entity, tx: "0xdef" }], settled, tx)).toThrow(/Arkiv price entity/)
  })

  it("fails when the average differs", () => {
    expect(() => checkArkivPrice([{ ...entity, avgPerUnit: 1n }], settled, tx)).toThrow(/average/)
  })
})
