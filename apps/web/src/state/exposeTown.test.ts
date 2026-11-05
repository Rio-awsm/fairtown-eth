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
