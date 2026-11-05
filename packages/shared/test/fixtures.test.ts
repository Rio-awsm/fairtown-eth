import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { fixtureUrl, Persona, SellerMessage } from "../src/fixtures"
import { TOWN_EVENT_TYPES, TownEnvelope, type TownEvent } from "../src/protocol"

const day = readFileSync(fixtureUrl("day"), "utf8")
  .trim()
  .split("\n")
  .map((l) => TownEnvelope.parse(JSON.parse(l)))
const agents = z.array(Persona).parse(JSON.parse(readFileSync(fixtureUrl("agents"), "utf8")))
const messages = z.array(SellerMessage).parse(JSON.parse(readFileSync(fixtureUrl("messages"), "utf8")))
const events = day.map((e) => e.event)
const of = <T extends TownEvent["type"]>(t: T) => events.filter((e): e is Extract<TownEvent, { type: T }> => e.type === t)

describe("fixtures/day.jsonl", () => {
  it("has about 300 envelopes with unique ids and non-decreasing blocks and ts", () => {
    expect(day.length).toBeGreaterThanOrEqual(250)
    expect(day.length).toBeLessThanOrEqual(350)
    expect(new Set(day.map((e) => e.id)).size).toBe(day.length)
    for (let i = 1; i < day.length; i++) {
      expect(day[i]!.block! >= day[i - 1]!.block!).toBe(true)
      expect(day[i]!.ts >= day[i - 1]!.ts).toBe(true)
    }
  })

  it("covers every TownEvent type", () => {
    const seen = new Set(events.map((e) => e.type))
    expect(TOWN_EVENT_TYPES.filter((t) => !seen.has(t))).toEqual([])
  })

  it("covers all seven scenes", () => {
    const commodities = new Set(of("lot.listed").map((l) => l.commodity))
    for (const c of ["cod", "truck_capacity", "gpu_hour", "marigold", "rose", "cargo_slot", "tomato", "storage_slot", "haddock"])
      expect(commodities).toContain(c)
    expect(of("lot.listed").some((l) => l.commodity === "truck_capacity" && l.place === "dallas")).toBe(true)
    expect(of("human.joined")).toHaveLength(1)
    expect(of("noshow.refunded")).toHaveLength(1)
    expect(of("signal").some((s) => s.label.includes("forced"))).toBe(true)
  })

  it("keeps staged payouts consistent", () => {
    for (const s of of("lot.settled")) {
      const raised = BigInt(s.avgPerUnit) * BigInt(s.soldUnits)
      expect(BigInt(s.sellerPaid) + BigInt(s.fee) + BigInt(s.held)).toBe(raised)
      expect(BigInt(s.fee)).toBe((raised * 100n) / 10000n)
    }
    const bergen = of("lot.settled").find((s) => s.lotId === "1")!
    expect(bergen).toMatchObject({ sellerPaid: "2702700000", held: "2702700000", fee: "54600000", avgPerUnit: "9100000" })
  })

  it("releases exactly the held money on lots paid in full without a dispute", () => {
    const disputed = new Set(of("dispute.opened").map((d) => d.lotId))
    for (const { lotId } of of("lot.paid_in_full")) {
      if (disputed.has(lotId)) continue
      const held = BigInt(of("lot.settled").find((s) => s.lotId === lotId)!.held)
      const released = of("handover.confirmed")
        .filter((h) => h.lotId === lotId)
        .reduce((a, h) => a + BigInt(h.releasedToSeller), 0n)
      expect(released).toBe(held)
    }
  })

  it("refunds the whole held share on the no-show", () => {
    const r = of("noshow.refunded")[0]!
    expect(r.refund).toBe(of("lot.settled").find((s) => s.lotId === r.lotId)!.held)
  })

  it("only references agents that exist", () => {
    const ids = new Set([...agents.map((a) => a.fixtureAgentId), ...of("human.joined").map((h) => h.agentId)])
    for (const b of of("bid.placed")) expect(ids).toContain(b.agentId)
    for (const i of of("agent.intent")) expect(ids).toContain(i.agentId)
  })
})

describe("fixtures/agents.json", () => {
  it("matches D-18 counts", () => {
    const count = (k: string) => agents.filter((a) => a.kind === k).length
    expect([count("seller"), count("buyer"), count("truck"), count("cold_store"), count("society"), count("compute_provider")]).toEqual([
      6, 12, 4, 2, 2, 1,
    ])
    expect(new Set(agents.map((a) => a.fixtureAgentId)).size).toBe(agents.length)
    expect(agents.filter((a) => a.seeded?.noShow).map((a) => a.id)).toEqual(["coastal_catch"])
  })
  it("gives every buyer and society a mandate", () => {
    for (const a of agents.filter((x) => x.kind === "buyer" || x.kind === "society")) expect(a.mandate).toBeDefined()
  })
})

describe("fixtures/messages.json", () => {
  it("has 20 seller messages, 2 of them hard", () => {
    expect(messages).toHaveLength(20)
    expect(messages.filter((m) => m.hard)).toHaveLength(2)
    const sellers = new Set(agents.map((a) => a.id))
    for (const m of messages) expect(sellers).toContain(m.sellerId)
  })
})
