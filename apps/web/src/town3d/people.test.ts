// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { BUBBLE_MAX } from "../game/commands"
import { Clock } from "./clock"
import { Models } from "./models"
import { Agent3D, STEP_MS, isPerson, nameTagShown, pick, polyline, tagText } from "./people"

const look = (role: "BUYER" | "SELLER", label = "Hanse Kitchen", highlight = false) => ({
  agentId: "0xabc",
  label,
  role,
  sprite: "x",
  highlight,
})
// Nothing loaded: every model is the clay stand-in, which is enough to test behaviour.
const make = (clock = new Clock()) => new Agent3D(clock, new Models())

describe("rules", () => {
  it("sellers, drivers and walk-ins are people; every other party is an AI agent", () => {
    expect(["SELLER", "TRUCK", "HUMAN"].every((r) => isPerson(r as "SELLER"))).toBe(true)
    expect(["BUYER", "STORAGE", "SOCIETY", "NONE"].some((r) => isPerson(r as "BUYER"))).toBe(false)
  })
  it("name tags show for highlighted people, on hover and when selected", () => {
    expect(nameTagShown({ highlight: false, hover: false, selected: false })).toBe(false)
    expect(nameTagShown({ highlight: true, hover: false, selected: false })).toBe(true)
    expect(nameTagShown({ highlight: false, hover: true, selected: false })).toBe(true)
    expect(nameTagShown({ highlight: false, hover: false, selected: true })).toBe(true)
  })
  it("names a party with its role, or just its name", () => {
    expect(tagText("Hanse Kitchen", "BUYER")).toBe("Hanse Kitchen · buyer")
    expect(tagText("Someone", "NONE")).toBe("Someone")
  })
  it("picks the same look for the same id every time", () => {
    expect(pick("0xabc", ["a", "b", "c"])).toBe(pick("0xabc", ["a", "b", "c"]))
  })
  it("walks a polyline at even speed and faces the way it goes", () => {
    const line = polyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
    expect(line.total).toBe(20)
    expect(line.at(5)).toMatchObject({ x: 5, y: 0 })
    expect(line.at(15)).toMatchObject({ x: 10, y: 5 })
    expect(line.at(99)).toMatchObject({ x: 10, y: 10 })
    expect(line.at(5).heading).toBeCloseTo(Math.PI / 2)
  })
})

describe("Agent3D", () => {
  it("stands where it is spawned, in map pixels, one world unit per tile", () => {
    const a = make().reset(look("BUYER"), { x: 32, y: 48 })
    expect([a.group.position.x, a.group.position.z]).toEqual([2, 3])
    expect(a.hits.every((h) => h.userData.agentId === "0xabc")).toBe(true)
  })
  it("walks the path at the replay pace, then arrives", () => {
    const clock = new Clock()
    const a = make(clock).reset(look("SELLER", "Ingrid"), { x: 0, y: 0 })
    const arrive = vi.fn()
    a.walk([{ x: 32, y: 0 }], arrive)
    expect(a.walking).toBe(true)
    clock.advance(STEP_MS)
    expect(a.x).toBeCloseTo(16)
    clock.advance(STEP_MS)
    expect(a.x).toBeCloseTo(32)
    expect(arrive).toHaveBeenCalledTimes(1)
    expect(a.walking).toBe(false)
  })
  it("an empty path arrives at once", () => {
    const arrive = vi.fn()
    make().reset(look("BUYER"), { x: 16, y: 16 }).walk([], arrive)
    expect(arrive).toHaveBeenCalledTimes(1)
  })
  it("says a capped line in a chip, then clears it", () => {
    const clock = new Clock()
    const a = make(clock).reset(look("BUYER"), { x: 0, y: 0 })
    a.say("x".repeat(BUBBLE_MAX + 20))
    const chip = a.group.children.find((c) => (c as { element?: HTMLElement }).element?.className === "ft-bubble")
    const text = (chip as unknown as { element: HTMLElement }).element.querySelector(".ft-bubble-text")!.textContent!
    expect(text.length).toBe(BUBBLE_MAX)
    expect(text.endsWith("…")).toBe(true)
    expect(a.speaking).toBe(true)
    clock.advance(3000)
    expect(a.speaking).toBe(false)
  })
  it("retiring stops the walk and hides the agent", () => {
    const clock = new Clock()
    const a = make(clock).reset(look("BUYER"), { x: 0, y: 0 })
    const arrive = vi.fn()
    a.walk([{ x: 64, y: 0 }], arrive)
    a.retire()
    clock.advance(10_000)
    expect(arrive).not.toHaveBeenCalled()
    expect(a.active).toBe(false)
  })
})
