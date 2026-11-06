import { ceilToTick, fromQ96, tickFor, toQ96 } from "@fairtown/shared/units"
import { describe, expect, it } from "vitest"
import { DEFAULT_BUDGET, apiMaxPerUnit, checkAmount, maxUnits, priceAt, tickPlan } from "./model"

describe("tickPlan and priceAt", () => {
  it("starts one tick above the floor before any bids", () => {
    const plan = tickPlan(1_200_000n)
    const floorQ96 = toQ96(1_200_000n)
    expect(plan.tickQ96).toBe(tickFor(floorQ96))
    expect(plan.firstQ96 > floorQ96).toBe(true)
    expect(plan.firstQ96 % plan.tickQ96).toBe(0n)
    expect(plan.firstQ96 - plan.tickQ96 <= floorQ96).toBe(true)
  })

  it("starts strictly above the clearing price once there are bids", () => {
    const plan = tickPlan(1_200_000n, 1_500_000n)
    const clearingQ96 = toQ96(1_500_000n)
    expect(plan.firstQ96 > clearingQ96).toBe(true)
    expect(plan.firstQ96 - plan.tickQ96 <= clearingQ96).toBe(true)
  })

  it("moves exactly one tick per slider step", () => {
    const plan = tickPlan(7_500_000n, 8_100_000n)
    expect(priceAt(plan, 3) - priceAt(plan, 2)).toBe(plan.tickQ96)
  })

  // The key rule: the slider can only give valid ticks above clearing, after the API's own conversion.
  const floors = [1_000n, 400_000n, 1_200_000n, 7_500_000n, 99_999_999n, 1_234_567_891n]
  for (const floor of floors) {
    for (const clearing of [undefined, floor, floor + 1n, (floor * 117n) / 100n]) {
      it(`round-trips every step for floor ${floor}, clearing ${clearing ?? "none"}`, () => {
        const plan = tickPlan(floor, clearing)
        const base = toQ96(clearing ?? floor)
        for (let step = 0; step < 40; step++) {
          const q = priceAt(plan, step)
          expect(q % plan.tickQ96).toBe(0n)
          expect(q > base).toBe(true)
          expect(ceilToTick(toQ96(apiMaxPerUnit(q)), plan.tickQ96)).toBe(q)
        }
      })
    }
  }

  it("sends the per-unit price the chain will round back to the tick", () => {
    const q = priceAt(tickPlan(1_200_000n), 0)
    expect(apiMaxPerUnit(q)).toBe(fromQ96(q))
  })
})

describe("checkAmount", () => {
  it("accepts an amount within the budget", () => {
    expect(checkAmount("20", 100_000_000n, "USD")).toEqual({ ok: true, value: 20_000_000n })
  })

  it.each([
    ["", "Enter how much to spend"],
    ["abc", "Enter an amount like 20"],
    ["0.5", "Spend at least $1.00"],
    ["150", "You can spend up to $100.00"],
  ])("rejects %s", (input, error) => {
    expect(checkAmount(input, 100_000_000n, "USD")).toEqual({ ok: false, error })
  })

  it("has a demo budget of 100.00 when the API gives none", () => {
    expect(DEFAULT_BUDGET).toBe(100_000_000n)
  })
})

describe("maxUnits", () => {
  it("says how many whole units the amount buys at most", () => {
    expect(maxUnits(20_000_000n, 1_600_000n)).toBe(12n)
    expect(maxUnits(1_000_000n, 1_600_000n)).toBe(0n)
  })
})
