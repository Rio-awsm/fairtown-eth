import { describe, expect, it } from "vitest"
import { declutter, nextStep, ZOOM_STEPS, zoomBy } from "./declutter"

const r = (x: number, y: number, w = 100, h = 30) => ({ left: x, top: y, right: x + w, bottom: y + h })

describe("declutter", () => {
  it("keeps every label that has room", () => {
    expect(
      declutter([
        { rect: r(0, 0), priority: 1 },
        { rect: r(200, 0), priority: 1 },
      ]),
    ).toEqual([])
  })
  it("hides the less important of two overlapping labels", () => {
    const hidden = declutter([
      { rect: r(0, 0), priority: 1 },
      { rect: r(50, 10), priority: 3 },
    ])
    expect(hidden).toEqual([0])
  })
  it("on a tie, the one listed first stays", () => {
    expect(
      declutter([
        { rect: r(0, 0), priority: 2 },
        { rect: r(20, 5), priority: 2 },
      ]),
    ).toEqual([1])
  })
  it("keeps a gap between labels, not just no overlap", () => {
    expect(
      declutter(
        [
          { rect: r(0, 0), priority: 1 },
          { rect: r(103, 0), priority: 1 },
        ],
        6,
      ),
    ).toEqual([1])
    expect(
      declutter(
        [
          { rect: r(0, 0), priority: 1 },
          { rect: r(110, 0), priority: 1 },
        ],
        6,
      ),
    ).toEqual([])
  })
  it("a label hidden by a stronger one does not hide a third that only it touched", () => {
    const hidden = declutter([
      { rect: r(0, 0), priority: 5 },
      { rect: r(60, 0), priority: 1 },
      { rect: r(140, 0), priority: 1 },
    ])
    expect(hidden).toEqual([1])
  })
  it("ignores empty rects (labels not on screen)", () => {
    expect(
      declutter([
        { rect: r(0, 0, 0, 0), priority: 1 },
        { rect: r(0, 0), priority: 1 },
      ]),
    ).toEqual([])
  })
})

describe("zoom steps", () => {
  it("run from the whole town to a street view", () => {
    expect(ZOOM_STEPS[0]).toBe(1)
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(6)
  })
  it("a notch moves one step either way and stops at the ends", () => {
    expect(nextStep(1, 1)).toBe(ZOOM_STEPS[1])
    expect(nextStep(6, 1)).toBe(6)
    expect(nextStep(1, -1)).toBe(1)
    expect(nextStep(2.2, -1)).toBe(2)
  })
  it("a trackpad delta zooms smoothly, within the ends", () => {
    expect(zoomBy(2, -100, 0.01)).toBeGreaterThan(2)
    expect(zoomBy(2, 100, 0.01)).toBeLessThan(2)
    expect(zoomBy(5.9, -10_000, 0.01)).toBe(6)
    expect(zoomBy(1.1, 10_000, 0.01)).toBe(1)
  })
})
