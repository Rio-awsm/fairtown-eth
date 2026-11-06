import { toBase } from "@fairtown/shared"
import { describe, expect, it } from "vitest"
import { computeClearing, type ClearingBid } from "../src/chain/fake/clearing"

const b = (id: number, max: string, amount: string): ClearingBid => ({
  id: BigInt(id),
  maxPerUnit: toBase(max),
  amount: toBase(amount),
})
const floor = toBase("7.50")

function invariants(bids: ClearingBid[], qty: bigint) {
  const r = computeClearing(bids, qty, floor)
  const units = r.fills.reduce((s, f) => s + f.units, 0n)
  expect(units <= qty).toBe(true)
  expect(r.clearingPerUnit >= floor).toBe(true)
  for (const f of r.fills) {
    const bid = bids.find((x) => x.id === f.id)!
    expect(f.paid).toBe(f.units * r.clearingPerUnit)
    expect(f.paid <= bid.amount).toBe(true)
    expect(bid.maxPerUnit >= r.clearingPerUnit).toBe(true)
  }
  return r
}

describe("computeClearing", () => {
  it("clears at the floor with no bids", () => {
    expect(computeClearing([], 600n, floor)).toEqual({ clearingPerUnit: floor, fills: [] })
  })
  it("clears at the floor when undersubscribed", () => {
    const r = invariants([b(1, "8.00", "2000")], 600n)
    expect(r.clearingPerUnit).toBe(floor)
    expect(r.fills).toEqual([{ id: 1n, units: 266n, paid: 266n * floor }])
  })
  it("clears the Bergen book at 9.10", () => {
    const r = invariants([b(3, "8.00", "2000"), b(1, "9.40", "2730"), b(2, "9.10", "2730")], 600n)
    expect(r.clearingPerUnit).toBe(toBase("9.10"))
    const units = Object.fromEntries(r.fills.map((f) => [String(f.id), f.units]))
    expect(units).toEqual({ "1": 300n, "2": 300n })
    expect(r.fills.every((f) => f.paid === toBase("2730"))).toBe(true)
  })
  it("rations a tied marginal tier by time and never oversells", () => {
    const r = invariants([b(1, "9.00", "3000"), b(2, "9.00", "3000")], 600n)
    expect(r.clearingPerUnit).toBe(toBase("9.00"))
    expect(r.fills.reduce((s, f) => s + f.units, 0n)).toBe(600n)
    expect(r.fills[0]).toMatchObject({ id: 1n, units: 333n })
  })
  it("ignores bids below the floor", () => {
    const r = invariants([b(1, "7.00", "5000")], 600n)
    expect(r.fills).toEqual([])
  })
  it("holds invariants on mixed books", () => {
    invariants([b(1, "12.00", "100"), b(2, "9.99", "9000"), b(3, "8.10", "40"), b(4, "7.60", "7000")], 600n)
    invariants([b(1, "7.51", "1"), b(2, "50.00", "100000")], 3n)
  })
})
