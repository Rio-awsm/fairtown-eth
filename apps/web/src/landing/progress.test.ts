import { describe, expect, it } from "vitest"
import { REC, clipTime, heroAt, progressOf, recProgress, smooth } from "./progress"

describe("progressOf", () => {
  const track = { top: 100, height: 4200 }
  it("is 0 at the track's top, 1 at its end, and clamped outside", () => {
    expect(progressOf(100, track, 1000)).toBe(0)
    expect(progressOf(100 + 3200, track, 1000)).toBe(1)
    expect(progressOf(1700, track, 1000)).toBeCloseTo(0.5)
    expect(progressOf(-50, track, 1000)).toBe(0)
    expect(progressOf(99_999, track, 1000)).toBe(1)
  })
  it("treats a track no taller than the window as finished, not broken", () => {
    expect(progressOf(0, { top: 0, height: 800 }, 1000)).toBe(0)
    expect(Number.isNaN(progressOf(0, { top: 0, height: 1000 }, 1000))).toBe(false)
  })
})

describe("heroAt", () => {
  it("at the top: the headline stands, the list is hidden, the cue shows with its full underline", () => {
    expect(heroAt(0)).toEqual({
      headline: { y: 0, rotate: 0, scale: 1, opacity: 1 },
      list: { y: 40, opacity: 0 },
      cue: { opacity: 1, line: 1 },
      step: 0,
    })
  })
  it("by .38 the headline lies back into the ground", () => {
    const h = heroAt(0.38).headline
    expect(h.y).toBeCloseTo(-34)
    expect(h.rotate).toBeCloseTo(62)
    expect(h.scale).toBeCloseTo(0.88)
  })
  it("fades the headline out between .10 and .24 and the list in between .08 and .24", () => {
    expect(heroAt(0.1).headline.opacity).toBe(1)
    expect(heroAt(0.17).headline.opacity).toBeCloseTo(0.5)
    expect(heroAt(0.24).headline.opacity).toBe(0)
    expect(heroAt(0.08).list.opacity).toBe(0)
    expect(heroAt(0.16).list.y).toBeCloseTo(20)
    expect(heroAt(0.16).list.opacity).toBeCloseTo(0.5)
    expect(heroAt(0.24).list).toEqual({ y: 0, opacity: 1 })
  })
  it("drains the cue's underline over the first 10% and fades the cue between .04 and .12", () => {
    expect(heroAt(0.05).cue.line).toBeCloseTo(0.5)
    expect(heroAt(0.1).cue.line).toBe(0)
    expect(heroAt(0.08).cue.opacity).toBeCloseTo(0.5)
    expect(heroAt(0.12).cue.opacity).toBe(0)
  })
  it("opens the four steps in turn: 01 until .40, 02 until .60, 03 until .80, then 04", () => {
    expect([0, 0.39, 0.4, 0.59, 0.6, 0.79, 0.8, 1].map((p) => heroAt(p).step)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })
  it("treats broken or out-of-range progress as the nearest end", () => {
    expect(heroAt(Number.NaN)).toEqual(heroAt(0))
    expect(heroAt(-2)).toEqual(heroAt(0))
    expect(heroAt(7)).toEqual(heroAt(1))
  })
})

describe("clipTime", () => {
  it("maps progress onto the clip, stopping half a frame at 24 fps short of the end", () => {
    expect(clipTime(0, 5.04)).toBe(0)
    expect(clipTime(1, 5.04)).toBeCloseTo(5.04 - 1 / 48)
    expect(clipTime(0.5, 5.04)).toBeCloseTo((5.04 - 1 / 48) / 2)
  })
  it("is 0 while the clip's length is unknown", () => {
    expect(clipTime(0.5, Number.NaN)).toBe(0)
    expect(clipTime(0.5, 0)).toBe(0)
  })
})

describe("smooth", () => {
  it("moves a fifth of the way each frame, and lands when close", () => {
    expect(smooth(0, 1)).toBeCloseTo(0.2)
    expect(smooth(0.99999, 1)).toBe(1)
  })
})

describe("recProgress", () => {
  it("holds for 0.55 s, glides linearly for 5.04 s, then holds", () => {
    expect(REC.total).toBe(6.5)
    expect(recProgress(0)).toBe(0)
    expect(recProgress(0.55)).toBe(0)
    expect(recProgress(0.55 + 2.52)).toBeCloseTo(0.5)
    expect(recProgress(0.55 + 5.04)).toBe(1)
    expect(recProgress(6.5)).toBe(1)
    expect(recProgress(Number.NaN)).toBe(0)
  })
})
