import { describe, expect, it, vi } from "vitest"
import { Clock } from "./clock"

describe("Clock", () => {
  it("runs timers once their time has come, in order", () => {
    const c = new Clock()
    const seen: string[] = []
    c.after(200, () => seen.push("b"))
    c.after(100, () => seen.push("a"))
    c.advance(150)
    expect(seen).toEqual(["a"])
    c.advance(60)
    expect(seen).toEqual(["a", "b"])
  })
  it("cancels a timer that has not fired", () => {
    const c = new Clock()
    const fn = vi.fn()
    c.after(100, fn)()
    c.advance(500)
    expect(fn).not.toHaveBeenCalled()
  })
  it("tweens 0 to 1 and calls done once; a zero-length tween lands at once", () => {
    const c = new Clock()
    const seen: number[] = []
    const done = vi.fn()
    c.tween(100, (t) => seen.push(t), done)
    c.advance(50)
    c.advance(50)
    c.advance(50)
    expect(seen).toEqual([0.5, 1])
    expect(done).toHaveBeenCalledTimes(1)
    const z: number[] = []
    c.tween(0, (t) => z.push(t))
    c.advance(16)
    expect(z).toEqual([1])
  })
  it("a throwing callback is reported and does not stop the others", () => {
    const c = new Clock()
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const fn = vi.fn()
    c.after(10, () => {
      throw new Error("boom")
    })
    c.after(10, fn)
    c.advance(20)
    expect(fn).toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it("stopping a tween leaves it where it was", () => {
    const c = new Clock()
    const seen: number[] = []
    const stop = c.tween(100, (t) => seen.push(t))
    c.advance(25)
    stop()
    c.advance(100)
    expect(seen).toEqual([0.25])
  })
})
