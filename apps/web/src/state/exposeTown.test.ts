import { describe, expect, it } from "vitest"
import { createEventBus } from "../game/EventBus"
import { SAMPLE_EVENTS as S, envelope } from "../test/samples"
import { exposeTown, type TownDebug } from "./exposeTown"
import { createTownStore } from "./townStore"

const seededStore = () => {
  const store = createTownStore(createEventBus())
  store.getState().applyEnvelope(envelope(S["lot.listed"]))
  return store
}

describe("exposeTown", () => {
  it("exposes the scene's agent probe as a frozen copy", () => {
    const bus = createEventBus()
    const store = createTownStore(bus)
    const target: { __TOWN__?: TownDebug } = {}
    exposeTown(target, store, true)
    const probe = {
      active: 1,
      agents: [{ id: "a", x: 8, y: 8, blocked: false, queue: "fish_dock:0" }],
      trucks: [],
      effectsSeen: { coinArc: 2 },
    }
    bus.emit("scene:probe", () => probe)
    expect(target.__TOWN__?.agents).toEqual({ active: 1, agents: probe.agents, trucks: [] })
    expect(target.__TOWN__?.effectsSeen).toEqual({ coinArc: 2 })
    expect(() => {
      ;(target.__TOWN__!.agents.agents as unknown[]).push({})
    }).toThrow(TypeError)
  })

  it("does nothing when disabled (production)", () => {
    const target: { __TOWN__?: TownDebug } = {}
    exposeTown(target, seededStore(), false)
    expect("__TOWN__" in target).toBe(false)
  })

  it("exposes live counters and state", () => {
    const target: { __TOWN__?: TownDebug } = {}
    const store = seededStore()
    exposeTown(target, store, true)
    expect(target.__TOWN__?.eventsApplied).toBe(1)
    store.getState().applyEnvelope(envelope(S["bid.placed"]))
    expect(target.__TOWN__?.eventsApplied).toBe(2)
    expect(target.__TOWN__?.state.lots["12"]?.bids).toBe(1)
    expect(target.__TOWN__).toMatchObject({ mode: "replay", rejected: 0, sceneCommandsApplied: 0 })
    expect(target.__TOWN__?.map).toEqual({ status: "loading", buildings: 0, problems: [] })
    expect(target.__TOWN__?.agents).toEqual({ active: 0, agents: [], trucks: [] })
    expect(target.__TOWN__?.effectsSeen).toEqual({})
    expect(() => {
      ;(target.__TOWN__!.map.problems as string[]).push("x")
    }).toThrow(TypeError)
  })

  it("is read-only: writes through the hook throw and never reach the store", () => {
    const target: { __TOWN__?: TownDebug } = {}
    const store = seededStore()
    exposeTown(target, store, true)
    const town = target.__TOWN__!
    expect(() => {
      ;(town.state.lots["12"] as { status: string }).status = "refunded"
    }).toThrow(TypeError)
    expect(() => {
      ;(town.commandLog as unknown[]).push("x")
    }).toThrow(TypeError)
    expect(() => {
      ;(town as { eventsApplied: number }).eventsApplied = 99
    }).toThrow(TypeError)
    expect(() => {
      target.__TOWN__ = undefined
    }).toThrow(TypeError)
    expect(store.getState().town.lots["12"]?.status).toBe("open")
  })
})
