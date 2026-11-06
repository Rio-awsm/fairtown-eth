import { describe, expect, it } from "vitest"
import { StallSlots, countdown, placeBuilding } from "./slots"

describe("StallSlots", () => {
  it("evicts a finished stall still drawn in the slot a new lot takes", () => {
    const s = new StallSlots()
    expect(s.place("12", "fish_dock", 1)).toEqual({})
    expect(s.place("60", "fish_dock", 1)).toEqual({ evicted: "12" })
    expect(s.holder("fish_dock", 1)).toBe("60")
  })

  it("does not evict when the same lot is placed again", () => {
    const s = new StallSlots()
    s.place("12", "fish_dock", 1)
    expect(s.place("12", "fish_dock", 1)).toEqual({})
  })

  it("frees the old slot when a lot moves", () => {
    const s = new StallSlots()
    s.place("12", "fish_dock", 1)
    s.place("12", "fish_dock", 2)
    expect(s.holder("fish_dock", 1)).toBeUndefined()
  })

  it("keeps slots per building", () => {
    const s = new StallSlots()
    s.place("12", "fish_dock", 1)
    expect(s.place("30", "flower_hall", 1)).toEqual({})
  })

  it("holds no slot for a waiting lot (slot null) and evicts nothing", () => {
    const s = new StallSlots()
    s.place("12", "fish_dock", 1)
    expect(s.place("99", "fish_dock", null)).toEqual({})
    expect(s.holder("fish_dock", 1)).toBe("12")
  })

  it("forgets a released lot", () => {
    const s = new StallSlots()
    s.place("12", "fish_dock", 1)
    s.release("12")
    expect(s.holder("fish_dock", 1)).toBeUndefined()
  })
})

describe("countdown", () => {
  it("turns blocks left into m:ss at about 2 s per block", () => {
    expect(countdown(1045, 1000)).toBe("1:30")
    expect(countdown(1000, 1000)).toBe("0:00")
    expect(countdown(990, 1000)).toBe("0:00")
    expect(countdown(1600, 1000)).toBe("20:00")
  })
})

describe("placeBuilding", () => {
  it.each([
    ["bergen", "fish_dock"],
    ["mumbai", "flower_hall"],
    ["lagos", "harvest_hall"],
    ["dallas", "freight_yard"],
    ["any_dc", "compute_yard"],
    ["nowhere", undefined],
  ] as const)("%s shows at %s", (place, building) => {
    expect(placeBuilding(place)).toBe(building)
  })
})
