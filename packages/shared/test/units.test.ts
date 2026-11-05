import { describe, expect, it } from "vitest"
import { ceilToTick, Dec, floorToTick, fromQ96, splitPayout, tickFor, toBase, toQ96 } from "../src/units"

describe("Q96 prices", () => {
  it("one base unit per unit is 79228162514, above the CCA minimum floor", () => {
    expect(toQ96(1n)).toBe(79228162514n)
    expect(toQ96(1n) >= 2n ** 32n + 1n).toBe(true)
  })

  it("round-trips per-unit prices to within one base unit, never above", () => {
    for (const p of [1_000n, 7_500_000n, 9_100_000n, 123_456_789n]) {
      const back = fromQ96(toQ96(p))
      expect(back <= p && p - back <= 1n).toBe(true)
    }
  })

  it("tick is 1% of floor with a minimum of 2", () => {
    expect(tickFor(100n)).toBe(2n)
    expect(tickFor(10_000n)).toBe(100n)
  })

  it("floor and ceil land on tick multiples on the correct side", () => {
    const q = toQ96(7_500_000n)
    const tick = tickFor(q)
    const down = floorToTick(q, tick)
    const up = ceilToTick(q, tick)
    expect(down % tick).toBe(0n)
    expect(up % tick).toBe(0n)
    expect(down <= q && q <= up).toBe(true)
    expect(ceilToTick(down, tick)).toBe(down)
  })
})

describe("toBase", () => {
  it("parses 6-decimal amounts", () => {
    expect(toBase("2702.70")).toBe(2_702_700_000n)
    expect(toBase("0.000001")).toBe(1n)
  })
})

describe("splitPayout", () => {
  const raised = toBase("1000")
  it("new seller gets 50% of net", () => {
    expect(splitPayout(raised, 100n, 5000n)).toEqual({ fee: 10_000_000n, advance: 495_000_000n, held: 495_000_000n })
  })
  it("proven seller gets 90% of net", () => {
    expect(splitPayout(raised, 100n, 9000n)).toEqual({ fee: 10_000_000n, advance: 891_000_000n, held: 99_000_000n })
  })
  it("truck gets 10% of net", () => {
    expect(splitPayout(raised, 100n, 1000n)).toEqual({ fee: 10_000_000n, advance: 99_000_000n, held: 891_000_000n })
  })
  it("matches the Bergen cod scene: EUR 5,460 raised", () => {
    expect(splitPayout(toBase("5460"), 100n, 5000n)).toEqual({
      fee: 54_600_000n,
      advance: 2_702_700_000n,
      held: 2_702_700_000n,
    })
  })
  it("fee + advance + held == raised for every combination", () => {
    for (const r of [0n, 1n, 7n, 99n, 10_001n, 5_460_000_000n, 2n ** 128n - 1n])
      for (const fee of [0n, 100n])
        for (const adv of [0n, 1000n, 5000n, 9000n, 10000n]) {
          const s = splitPayout(r, fee, adv)
          expect(s.fee + s.advance + s.held).toBe(r)
          expect(s.fee >= 0n && s.advance >= 0n && s.held >= 0n).toBe(true)
        }
  })
})

describe("Dec", () => {
  it("accepts unsigned decimal strings only", () => {
    expect(Dec.safeParse("0").success).toBe(true)
    expect(Dec.safeParse("5460000000").success).toBe(true)
    for (const bad of ["-1", "1.5", "", "0x10", " 1"]) expect(Dec.safeParse(bad).success).toBe(false)
  })
})
