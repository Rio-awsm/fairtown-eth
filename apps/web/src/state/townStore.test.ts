import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEventBus } from "../game/EventBus"
import type { TownCommand } from "../game/commands"
import { parseJsonl } from "../net/jsonl"
import { DAY_JSONL } from "../net/replayClient"
import { SAMPLE_EVENTS as S, emptySnapshot, envelope } from "../test/samples"
import { connectTown } from "./connectTown"
import { COMMAND_LOG_MAX, createTownStore } from "./townStore"

const setup = () => {
  const bus = createEventBus()
  const emitted: TownCommand[][] = []
  bus.on("town:commands", (c) => emitted.push(c))
  return { bus, emitted, store: createTownStore(bus) }
}

describe("townStore", () => {
  it("applies an envelope through the reducer and emits its commands on the bus", () => {
    const { store, emitted } = setup()
    store.getState().applyEnvelope(envelope(S["lot.listed"], "e1"))
    const s = store.getState()
    expect(s.eventsApplied).toBe(1)
    expect(s.lastEventId).toBe("e1")
    expect(s.town.lots["12"]?.status).toBe("open")
    expect(emitted[0]?.map((c) => c.kind)).toEqual(["placeStall", "setStatus"])
    expect(s.commandLog).toHaveLength(2)
  })

  it("keeps only the last 200 commands in the log", () => {
    const { store } = setup()
    for (let i = 0; i < 250; i++) store.getState().applyEnvelope(envelope(S["fx.updated"]))
    for (let i = 0; i < 250; i++) store.getState().applyEnvelope(envelope(S["bid.placed"]))
    store.getState().applyEnvelope(envelope(S["lot.listed"]))
    for (let i = 0; i < 250; i++) store.getState().applyEnvelope(envelope(S["bid.placed"]))
    expect(store.getState().commandLog).toHaveLength(COMMAND_LOG_MAX)
    expect(COMMAND_LOG_MAX).toBe(200)
  })

  it("hydrates from a snapshot and emits the redraw", () => {
    const { store, emitted } = setup()
    store
      .getState()
      .applySnapshot({ ...emptySnapshot(), block: 1050, lots: [{ ...S["lot.listed"], status: "open", bids: 0 }] })
    expect(store.getState().town.block).toBe(1050)
    expect(emitted[0]?.map((c) => c.kind)).toEqual(["placeStall", "setStatus"])
  })

  it("redraws the current town when the scene reports ready", () => {
    const { store, bus, emitted } = setup()
    store.getState().applyEnvelope(envelope(S["lot.listed"]))
    store.getState().applyEnvelope(envelope(S["agent.spawned"]))
    emitted.length = 0
    bus.emit("scene:ready", undefined)
    expect(emitted[0]?.map((c) => c.kind)).toEqual(["placeStall", "setStatus", "spawnAgent"])
  })

  it("counts commands the scene applied", () => {
    const { store, bus } = setup()
    bus.emit("scene:applied", 3)
    bus.emit("scene:applied", 2)
    expect(store.getState().sceneCommandsApplied).toBe(5)
  })

  it("tracks the map status the scene reports", () => {
    const { store, bus } = setup()
    expect(store.getState().map).toEqual({ status: "loading", buildings: 0, problems: [] })
    bus.emit("map:status", { status: "error", buildings: 7, problems: ["missing anchor fish_dock.stall_3"] })
    expect(store.getState().map).toEqual({
      status: "error",
      buildings: 7,
      problems: ["missing anchor fish_dock.stall_3"],
    })
  })

  it("counts rejected frames", () => {
    const { store } = setup()
    store.getState().noteReject()
    expect(store.getState().rejected).toBe(1)
  })
})

describe("connectTown", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("replays the whole day in mock mode, once per unique id", async () => {
    const { store } = setup()
    const client = connectTown({ relay: { mode: "mock" } }, store, { speed: 100 })
    client.start()
    expect(store.getState().mode).toBe("replay")
    await vi.runAllTimersAsync()
    const unique = new Set(parseJsonl(DAY_JSONL).envelopes.map((e) => e.id)).size
    expect(store.getState()).toMatchObject({ status: "replay_done", eventsApplied: unique, rejected: 0 })
    client.stop()
  })

  it("uses the live relay and reports LIVE mode when a relay URL is set", () => {
    const { store } = setup()
    const WebSocketImpl = vi.fn(function (this: { close: () => void }) {
      this.close = () => {}
    })
    const client = connectTown(
      { relay: { mode: "live", wsUrl: "ws://relay.test/ws", snapshotUrl: "http://relay.test/snapshot" } },
      store,
      { WebSocketImpl: WebSocketImpl as unknown as typeof WebSocket },
    )
    client.start()
    expect(store.getState()).toMatchObject({ mode: "live", status: "connecting" })
    expect(WebSocketImpl).toHaveBeenCalledWith("ws://relay.test/ws")
    client.stop()
  })
})
