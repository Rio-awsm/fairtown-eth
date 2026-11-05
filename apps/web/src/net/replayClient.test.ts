import type { TownEnvelope } from "@fairtown/shared/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SAMPLE_EVENTS } from "../test/samples"
import type { RelayStatus } from "./relayClient"
import { createReplayClient } from "./replayClient"

const at = (id: string, ts: number): TownEnvelope => ({ v: 1, id, ts, source: "chain", event: SAMPLE_EVENTS.clock })
const jsonl = (...lines: unknown[]) => lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")

function setup(text: string, speed: number, until?: string) {
  const delivered: string[] = []
  const statuses: RelayStatus[] = []
  const rejects: string[] = []
  let snapshots = 0
  const client = createReplayClient({
    jsonl: text,
    speed,
    ...(until ? { until } : {}),
    handlers: {
      onSnapshot: () => snapshots++,
      onEnvelope: (e) => delivered.push(e.id),
      onStatus: (s) => statuses.push(s),
      onReject: (r) => rejects.push(r),
    },
  })
  return { client, delivered, statuses, rejects, snapshots: () => snapshots }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("createReplayClient", () => {
  it("replays envelopes at the recorded pace divided by speed", async () => {
    const t = setup(jsonl(at("a", 0), at("b", 1000), at("c", 2000)), 20)
    t.client.start()
    expect(t.statuses).toEqual(["replay"])
    expect(t.snapshots()).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.delivered).toEqual(["a"])
    await vi.advanceTimersByTimeAsync(50)
    expect(t.delivered).toEqual(["a", "b"])
    await vi.advanceTimersByTimeAsync(50)
    expect(t.delivered).toEqual(["a", "b", "c"])
    expect(t.statuses).toEqual(["replay", "replay_done"])
  })

  it("stops after the envelope named by until", async () => {
    const t = setup(jsonl(at("a", 0), at("b", 10), at("c", 20)), 1, "b")
    t.client.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(t.delivered).toEqual(["a", "b"])
    expect(t.statuses).toEqual(["replay", "replay_done"])
  })

  it("delivers a duplicate id once", async () => {
    const t = setup(jsonl(at("a", 0), at("a", 10), at("b", 20)), 1)
    t.client.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(t.delivered).toEqual(["a", "b"])
  })

  it("reports bad lines and still replays the good ones", async () => {
    const t = setup(jsonl(at("a", 0), "not json", at("b", 10)), 1)
    t.client.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(t.delivered).toEqual(["a", "b"])
    expect(t.rejects).toHaveLength(1)
  })

  it("stops delivering after stop and ignores a second start", async () => {
    const t = setup(jsonl(at("a", 0), at("b", 1000)), 1)
    t.client.start()
    t.client.start()
    await vi.advanceTimersByTimeAsync(0)
    t.client.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.delivered).toEqual(["a"])
    expect(t.snapshots()).toBe(1)
  })
})
