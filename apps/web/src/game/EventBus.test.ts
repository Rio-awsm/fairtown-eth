import { describe, expect, it } from "vitest"
import { createEventBus } from "./EventBus"

describe("EventBus", () => {
  it("delivers a payload to every listener of that event only", () => {
    const bus = createEventBus()
    const got: number[] = []
    bus.on("scene:applied", (n) => got.push(n))
    bus.on("scene:applied", (n) => got.push(n * 10))
    bus.emit("scene:ready", undefined)
    bus.emit("scene:applied", 2)
    expect(got).toEqual([2, 20])
  })

  it("stops delivery after the returned unsubscribe runs", () => {
    const bus = createEventBus()
    const got: number[] = []
    const off = bus.on("scene:applied", (n) => got.push(n))
    bus.emit("scene:applied", 1)
    off()
    bus.emit("scene:applied", 2)
    expect(got).toEqual([1])
  })

  it("keeps delivering to other listeners when one throws, and reports the error", () => {
    const bus = createEventBus()
    const errors: unknown[] = []
    const got: number[] = []
    const original = console.error
    console.error = (...args: unknown[]) => errors.push(args)
    try {
      bus.on("scene:applied", () => {
        throw new Error("boom")
      })
      bus.on("scene:applied", (n) => got.push(n))
      bus.emit("scene:applied", 3)
    } finally {
      console.error = original
    }
    expect(got).toEqual([3])
    expect(errors).toHaveLength(1)
  })
})
