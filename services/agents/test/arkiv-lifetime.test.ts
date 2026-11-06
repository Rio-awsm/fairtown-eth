import { describe, expect, it } from "vitest"
import { lifetimeSeconds } from "../src/arkiv/LiveArkivStore"

describe("Arkiv lifetimes (2 s blocks)", () => {
  it("rounds odd seconds up to the next even second", () => {
    expect(lifetimeSeconds(3667)).toBe(3668)
    expect(lifetimeSeconds(3600)).toBe(3600)
    expect(lifetimeSeconds(3600.4)).toBe(3602)
  })

  it("never goes below 60 s", () => {
    expect(lifetimeSeconds(1)).toBe(60)
    expect(lifetimeSeconds(-5)).toBe(60)
  })
})
