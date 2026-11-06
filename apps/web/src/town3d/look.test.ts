import { describe, expect, it } from "vitest"
import { clayTone, fitScale, isGlass } from "./look"

describe("isGlass", () => {
  it("picks the palette's pale-blue glass", () => {
    expect(isGlass(207, 229, 255)).toBe(true)
    expect(isGlass(180, 210, 250)).toBe(true)
  })
  it("leaves blue paint, grey concrete, white and dark texels alone", () => {
    expect(isGlass(95, 143, 214)).toBe(false)
    expect(isGlass(140, 145, 160)).toBe(false)
    expect(isGlass(255, 255, 255)).toBe(false)
    expect(isGlass(20, 20, 30)).toBe(false)
  })
})

describe("clayTone", () => {
  it("turns any colour into a graphite clay grey that keeps light and dark apart", () => {
    const light = clayTone(240, 240, 240)
    const dark = clayTone(40, 40, 40)
    expect(light[0]).toBeGreaterThan(dark[0])
    for (const c of [light, dark]) {
      expect(Math.abs(c[0] - c[1])).toBeLessThan(20)
      expect(c[2]).toBeGreaterThanOrEqual(c[0])
    }
  })
  it("stays inside the clay range: never black, never white", () => {
    expect(Math.min(...clayTone(0, 0, 0))).toBeGreaterThan(25)
    expect(Math.max(...clayTone(255, 255, 255))).toBeLessThan(200)
  })
})

describe("fitScale", () => {
  it("scales a model so its footprint fits the space, keeping its proportions", () => {
    expect(fitScale({ x: 2, y: 2.3, z: 2 }, { w: 8, d: 5 })).toBeCloseTo(2.5)
    expect(fitScale({ x: 4, y: 1, z: 1 }, { w: 2, d: 2 })).toBeCloseTo(0.5)
  })
  it("fits by height when only a height is asked for", () => {
    expect(fitScale({ x: 1, y: 2, z: 1 }, { h: 0.9 })).toBeCloseTo(0.45)
  })
  it("a flat or empty model gets scale 1 rather than infinity", () => {
    expect(fitScale({ x: 0, y: 0, z: 0 }, { w: 3, d: 3 })).toBe(1)
  })
})

describe("adaptScale", () => {
  it("draws 10% smaller under 50 fps, never below 60%", async () => {
    const { adaptScale } = await import("./stage")
    expect(adaptScale(1, 40, 0)).toEqual({ scale: 0.9, calm: 0 })
    expect(adaptScale(0.6, 30, 2)).toEqual({ scale: 0.6, calm: 0 })
  })
  it("climbs back only after three calm checks, never above full size", async () => {
    const { adaptScale } = await import("./stage")
    expect(adaptScale(0.8, 60, 0)).toEqual({ scale: 0.8, calm: 1 })
    expect(adaptScale(0.8, 60, 2)).toEqual({ scale: 0.9, calm: 0 })
    expect(adaptScale(1, 60, 5)).toEqual({ scale: 1, calm: 6 })
  })
  it("between 50 and 57 fps it holds", async () => {
    const { adaptScale } = await import("./stage")
    expect(adaptScale(0.9, 54, 2)).toEqual({ scale: 0.9, calm: 0 })
  })
})
