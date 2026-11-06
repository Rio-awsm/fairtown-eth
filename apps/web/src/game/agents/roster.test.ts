import { describe, expect, it } from "vitest"
import { AgentRoster } from "./roster"

describe("AgentRoster", () => {
  it("gives a returning agent the same slot", () => {
    const r = new AgentRoster(3)
    const first = r.admit("a", { human: false })
    expect(r.admit("a", { human: false })).toEqual({ slot: first?.slot })
    expect(r.size).toBe(1)
  })

  it("caps at the limit by recycling the least recently active agent", () => {
    const r = new AgentRoster(2)
    r.admit("a", { human: false })
    r.admit("b", { human: false })
    r.touch("a")
    const c = r.admit("c", { human: false })
    expect(c).toMatchObject({ evicted: "b" })
    expect(r.slotOf("b")).toBeUndefined()
    expect(r.size).toBe(2)
  })

  it("never evicts a human walk-in", () => {
    const r = new AgentRoster(2)
    r.admit("judge", { human: true })
    r.admit("bot", { human: false })
    r.touch("judge")
    r.touch("bot")
    expect(r.admit("bot2", { human: false })).toMatchObject({ evicted: "bot" })
    expect(r.slotOf("judge")).toBeDefined()
  })

  it("refuses when every slot holds a human", () => {
    const r = new AgentRoster(1)
    r.admit("judge", { human: true })
    expect(r.admit("bot", { human: false })).toBeNull()
  })

  it("reuses a removed agent's slot", () => {
    const r = new AgentRoster(2)
    const a = r.admit("a", { human: false })!
    r.admit("b", { human: false })
    r.remove("a")
    expect(r.admit("c", { human: false })).toEqual({ slot: a.slot })
  })

  it("defaults to 80 agents", () => {
    const r = new AgentRoster()
    for (let i = 0; i < 100; i++) r.admit(`agent-${i}`, { human: false })
    expect(r.size).toBe(80)
  })
})
