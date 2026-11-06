import { describe, expect, it } from "vitest"
import { fitZoom, glideAt, splitSign } from "./layout"

describe("fitZoom", () => {
  it("snaps the town's 1.985 fit to a whole 2 for crisp pixels", () => {
    expect(fitZoom({ width: 1920, height: 1080 }, { w: 960, h: 544 })).toBe(2)
  })

  it("keeps a fit that is far from a whole number", () => {
    expect(fitZoom({ width: 1920, height: 1080 }, { w: 1280, h: 720 })).toBe(1.5)
  })

  it("never snaps below 1 and survives an empty map", () => {
    expect(fitZoom({ width: 1920, height: 1080 }, { w: 3000, h: 2000 })).toBeCloseTo(0.54)
    expect(fitZoom({ width: 1920, height: 1080 }, { w: 0, h: 0 })).toBe(1)
  })
})

describe("splitSign", () => {
  it("puts the building name on top and the place underneath", () => {
    expect(splitSign("Flower Hall · Mumbai · Nairobi to Amsterdam")).toEqual({
      title: "Flower Hall",
      subtitle: "Mumbai · Nairobi to Amsterdam",
    })
  })

  it("leaves a one-part sign alone", () => {
    expect(splitSign("Cold Vault")).toEqual({ title: "Cold Vault", subtitle: null })
  })
})

describe("glideAt", () => {
  it("eases from start to end and lands exactly on the target", () => {
    expect(glideAt(0)).toBe(0)
    expect(glideAt(0.5)).toBeCloseTo(0.5)
    expect(glideAt(1)).toBe(1)
    expect(glideAt(0.25)).toBeLessThan(0.25)
  })

  it("clamps progress outside 0..1", () => {
    expect(glideAt(-1)).toBe(0)
    expect(glideAt(2)).toBe(1)
  })
})
