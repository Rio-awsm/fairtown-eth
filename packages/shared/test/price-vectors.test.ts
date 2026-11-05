import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ceilToTick, Dec, floorToTick, fromQ96, splitPayout, tickFor, toQ96 } from "../src/units"

// Written by contracts/test/unit/PriceMath.t.sol (test_exportPriceVectors) from Solidity PriceMath (S1 1.1).
const FILE = fileURLToPath(new URL("../fixtures/price-vectors.json", import.meta.url))

const Vector = z.object({
  perUnit: Dec,
  q96: Dec,
  fromQ96: Dec,
  tick: Dec,
  floorQ96: Dec,
  bidInQ96: Dec,
  bidQ96: Dec,
  raised: Dec,
  feeBps: Dec,
  advanceBps: Dec,
  fee: Dec,
  advance: Dec,
  held: Dec,
})
const Vectors = z.record(z.string(), Vector)
const vectors = Vectors.parse(JSON.parse(readFileSync(FILE, "utf8")))

describe("Solidity PriceMath vectors match units.ts", () => {
  it("has the 20 exported vectors", () => {
    expect(Object.keys(vectors)).toHaveLength(20)
  })

  it.each(Object.entries(vectors))("%s", (_, v) => {
    const q = toQ96(BigInt(v.perUnit))
    const tick = tickFor(q)
    expect(q).toBe(BigInt(v.q96))
    expect(fromQ96(q)).toBe(BigInt(v.fromQ96))
    expect(tick).toBe(BigInt(v.tick))
    expect(floorToTick(q, tick)).toBe(BigInt(v.floorQ96))
    expect(ceilToTick(BigInt(v.bidInQ96), tick)).toBe(BigInt(v.bidQ96))
    const s = splitPayout(BigInt(v.raised), BigInt(v.feeBps), BigInt(v.advanceBps))
    expect(s).toEqual({ fee: BigInt(v.fee), advance: BigInt(v.advance), held: BigInt(v.held) })
    expect(s.fee + s.advance + s.held).toBe(BigInt(v.raised))
  })

  it("rejects a vector that is not a decimal string", () => {
    const bad = { v0: { ...vectors.v0, q96: "0x1f" } }
    expect(() => Vectors.parse(bad)).toThrow()
  })

  it("would catch a drifted value", () => {
    const v = vectors.v1!
    expect(toQ96(BigInt(v.perUnit))).not.toBe(BigInt(v.q96) + 1n)
  })
})
