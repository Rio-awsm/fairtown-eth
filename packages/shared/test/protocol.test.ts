import { describe, expect, it } from "vitest"
import { TOWN_EVENT_TYPES, TownEnvelope, TownEvent, TownSnapshot } from "../src/protocol"
import { SAMPLES } from "./samples"

describe("TownEvent", () => {
  it("has a sample for every event type and no extras", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...TOWN_EVENT_TYPES].sort())
  })
  it.each(Object.entries(SAMPLES))("parses %s", (_, ev) => {
    expect(TownEvent.parse(ev)).toEqual(ev)
  })
  it("rejects unknown event types", () => {
    expect(TownEvent.safeParse({ type: "lot.exploded", lotId: "1" }).success).toBe(false)
  })
  it("rejects bigint fields sent as JSON numbers", () => {
    expect(TownEvent.safeParse({ ...SAMPLES["price.tick"], clearingPerUnit: 8100000 }).success).toBe(false)
  })
  it("rejects a building outside the enum", () => {
    expect(TownEvent.safeParse({ ...SAMPLES["agent.spawned"], building: "casino" }).success).toBe(false)
  })
})

describe("TownEnvelope", () => {
  const env = {
    v: 1,
    id: "chain:0xab:3",
    ts: 1762380000000,
    block: 1200,
    source: "chain",
    event: SAMPLES["lot.paid_in_full"],
  }
  it("parses a chain envelope", () => expect(TownEnvelope.parse(env)).toEqual(env))
  it("rejects protocol version 2", () => expect(TownEnvelope.safeParse({ ...env, v: 2 }).success).toBe(false))
  it("rejects unknown sources", () => expect(TownEnvelope.safeParse({ ...env, source: "twitter" }).success).toBe(false))
})

describe("TownSnapshot", () => {
  it("parses a snapshot with a lot, agent, signal and fx", () => {
    const snap = {
      block: 1200,
      lots: [{ ...SAMPLES["lot.listed"], status: "sold", avgPerUnit: "9100000", bids: 4, pickupDeadline: 1345 }],
      agents: [
        {
          agentId: SAMPLES["agent.spawned"].agentId,
          name: "Hanse Kitchen",
          role: "BUYER",
          building: "fish_dock",
          sprite: "chef",
        },
      ],
      signals: [SAMPLES.signal],
      fx: { NOK: 10.92 },
      recent: [],
    }
    expect(TownSnapshot.parse(snap)).toEqual(snap)
  })
  it("rejects more than 200 recent envelopes", () => {
    const env = { v: 1, id: "x", ts: 1, source: "chain", event: SAMPLES["lot.paid_in_full"] }
    const snap = { block: 1, lots: [], agents: [], signals: [], fx: {}, recent: Array(201).fill(env) }
    expect(TownSnapshot.safeParse(snap).success).toBe(false)
  })
})
