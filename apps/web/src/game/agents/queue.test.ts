import { describe, expect, it } from "vitest"
import { QueueAllocator } from "./queue"

describe("QueueAllocator", () => {
  it("gives each agent its own spot, lowest first", () => {
    const q = new QueueAllocator(8)
    expect(q.claim("a", "fish_dock")).toBe(0)
    expect(q.claim("b", "fish_dock")).toBe(1)
    expect(q.occupant("fish_dock", 1)).toBe("b")
  })

  it("keeps the same spot when an agent claims the same building again", () => {
    const q = new QueueAllocator(8)
    q.claim("a", "fish_dock")
    expect(q.claim("a", "fish_dock")).toBe(0)
  })

  it("releases the old spot when an agent moves to another building", () => {
    const q = new QueueAllocator(8)
    q.claim("a", "fish_dock")
    expect(q.claim("a", "flower_hall")).toBe(0)
    expect(q.occupant("fish_dock", 0)).toBeUndefined()
    expect(q.claim("b", "fish_dock")).toBe(0)
  })

  it("returns null when a building is full and never shares a spot", () => {
    const q = new QueueAllocator(2)
    q.claim("a", "fish_dock")
    q.claim("b", "fish_dock")
    expect(q.claim("c", "fish_dock")).toBeNull()
    expect(q.spotOf("c")).toBeUndefined()
  })

  it("gives up its old spot when the new building is full", () => {
    const q = new QueueAllocator(1)
    q.claim("a", "fish_dock")
    q.claim("b", "flower_hall")
    expect(q.claim("a", "flower_hall")).toBeNull()
    expect(q.occupant("fish_dock", 0)).toBeUndefined()
    expect(q.spotOf("a")).toBeUndefined()
  })

  it("frees a spot on release", () => {
    const q = new QueueAllocator(1)
    q.claim("a", "fish_dock")
    q.release("a")
    expect(q.claim("b", "fish_dock")).toBe(0)
  })

  it("has no queue at the town gate", () => {
    expect(new QueueAllocator(8).claim("a", "town_gate")).toBeNull()
  })

  it("never double-books under churn", () => {
    const q = new QueueAllocator(8)
    const buildings = ["fish_dock", "flower_hall", "compute_yard"] as const
    for (let i = 0; i < 2000; i++) q.claim(`agent-${i % 30}`, buildings[(i * 7) % 3]!)
    for (const b of buildings) {
      const seen = new Set<string>()
      for (let s = 0; s < 8; s++) {
        const who = q.occupant(b, s)
        if (who) {
          expect(seen.has(who)).toBe(false)
          seen.add(who)
          expect(q.spotOf(who)).toEqual({ building: b, index: s })
        }
      }
    }
  })
})
