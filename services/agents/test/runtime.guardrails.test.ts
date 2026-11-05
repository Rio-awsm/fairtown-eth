import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { checkBid, DEFAULT_GUARDRAILS } from "../src/runtime/guardrails"
import type { Decision, Observation } from "../src/runtime/types"
import { ruleStrategy } from "../src/strategies/rule"

const base = (over: { agent?: Partial<Observation["agent"]>; lot?: Partial<Observation["lot"]> } & Partial<Omit<Observation, "agent" | "lot">> = {}): Observation => ({
  budgetLeft: 10_000_000_000n,
  exposureOnLot: 0n,
  myBestOnLot: 0n,
  ...over,
  agent: {
    agentId: "0x00000000000000000000000000000000000000b1",
    name: "Hanse",
    role: "BUYER",
    kind: "buyer",
    building: "town_gate",
    sprite: "chef",
    currency: "EUR",
    budget: 20_000_000_000n,
    mandate: { commodities: ["cod", "haddock"], maxPerUnit: "9400000", minGrade: "fresh_a", avoidNoShowSellers: true },
    paused: false,
    walletIndex: 6,
    ...over.agent,
  },
  lot: {
    lotId: 1n,
    auction: "0xa100000000000000000000000000000000000001",
    sector: "fish",
    commodity: "cod",
    grade: "fresh_a",
    building: "fish_dock",
    place: "bergen",
    seller: "0x00000000000000000000000000000000000000a1",
    sellerRecord: { cleanLots: 0, noShows: 0, proven: false },
    currency: "EUR",
    qty: 600n,
    floorPerUnit: 7_500_000n,
    clearingPerUnit: 7_500_000n,
    tickPerUnit: 75_001n,
    endBlock: 46n,
    blocksLeft: 30n,
    ...over.lot,
  },
})
const bid = (maxPerUnit: bigint, amount: bigint): Decision => ({ action: "bid", maxPerUnit: maxPerUnit.toString(), amount: amount.toString(), reason: "test" })

describe("guardrails (properties)", () => {
  const arb = fc.record({
    price: fc.bigInt({ min: 0n, max: 50_000_000n }),
    amount: fc.bigInt({ min: 0n, max: 100_000_000_000n }),
    clearing: fc.bigInt({ min: 1_000n, max: 20_000_000n }),
    tick: fc.bigInt({ min: 2n, max: 200_000n }),
    budget: fc.bigInt({ min: 0n, max: 50_000_000_000n }),
    budgetLeft: fc.bigInt({ min: 0n, max: 50_000_000_000n }),
    exposureOnLot: fc.bigInt({ min: 0n, max: 30_000_000_000n }),
    mandateMax: fc.bigInt({ min: 1_000n, max: 30_000_000n }),
    noShows: fc.integer({ min: 0, max: 3 }),
    avoid: fc.boolean(),
    recent: fc.integer({ min: 0, max: 10 }),
  })

  it("never lets a bid exceed the mandate max, budget, exposure cap or rate limit, and always tops clearing by a tick", () => {
    fc.assert(
      fc.property(arb, (x) => {
        const o = base({
          budgetLeft: x.budgetLeft,
          exposureOnLot: x.exposureOnLot,
          agent: { budget: x.budget, mandate: { commodities: ["cod"], maxPerUnit: x.mandateMax.toString(), avoidNoShowSellers: x.avoid } },
          lot: { clearingPerUnit: x.clearing, tickPerUnit: x.tick, sellerRecord: { cleanLots: 0, noShows: x.noShows, proven: false } },
        })
        const now = 1_000_000
        const r = checkBid(bid(x.price, x.amount), o, Array.from({ length: x.recent }, () => now - 1000), now)
        if (!r.ok) return true
        const cap = (x.budget * DEFAULT_GUARDRAILS.perAuctionBps) / 10000n - x.exposureOnLot
        expect(r.maxPerUnit <= x.mandateMax).toBe(true)
        expect(r.maxPerUnit >= x.clearing + x.tick).toBe(true)
        expect(r.amount <= x.budgetLeft).toBe(true)
        expect(r.amount <= cap).toBe(true)
        expect(r.amount >= r.maxPerUnit).toBe(true)
        expect(x.noShows === 0 || !x.avoid).toBe(true)
        expect(x.recent < DEFAULT_GUARDRAILS.maxBidsPerMinute).toBe(true)
        return true
      }),
      { numRuns: 2000 },
    )
  })

  it("only ever passes bids from bidding roles in the lot's currency", () => {
    fc.assert(
      fc.property(fc.constantFrom("SELLER", "TRUCK", "STORAGE", "BUYER", "SOCIETY", "HUMAN"), fc.constantFrom("EUR", "USD"), (role, currency) => {
        const r = checkBid(bid(8_000_000n, 1_000_000_000n), base({ agent: { role: role as never, currency: currency as never } }), [], 0)
        expect(r.ok).toBe(["BUYER", "SOCIETY", "HUMAN"].includes(role) && currency === "EUR")
      }),
    )
  })
})

describe("guardrails (cases)", () => {
  it.each([
    ["off-mandate commodity", base({ lot: { commodity: "tomato" } }), "not in mandate"],
    ["low grade", base({ lot: { grade: "fresh_b" } }), "below fresh_a"],
    ["no-show seller", base({ lot: { sellerRecord: { cleanLots: 0, noShows: 1, proven: false } } }), "no-show"],
    ["paused", base({ agent: { paused: true } }), "paused"],
    ["ended", base({ lot: { blocksLeft: 0n } }), "ended"],
    ["wrong place", base({ agent: { mandate: { commodities: ["cod"], maxPerUnit: "9400000", place: "oslo", avoidNoShowSellers: true } } }), "outside mandate"],
  ])("rejects %s", (_n, o, reason) => {
    const r = checkBid(bid(8_000_000n, 1_000_000_000n), o, [], 0)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain(reason)
  })
  it("clamps price to the mandate and amount to what is left of the budget", () => {
    const r = checkBid(bid(99_000_000n, 99_000_000_000n), base(), [], 0)
    expect(r).toMatchObject({ ok: true, maxPerUnit: 9_400_000n, amount: 10_000_000_000n })
    expect(checkBid(bid(9_000_000n, 99_000_000_000n), base({ budgetLeft: 50_000_000_000n }), [], 0)).toMatchObject({ amount: 12_000_000_000n })
    expect((r as { clamped: string[] }).clamped).toHaveLength(2)
  })
  it("allows a no-show seller when the mandate opts in", () => {
    const o = base({ agent: { mandate: { commodities: ["cod"], maxPerUnit: "9400000", avoidNoShowSellers: false } }, lot: { sellerRecord: { cleanLots: 0, noShows: 2, proven: false } } })
    expect(checkBid(bid(8_000_000n, 1_000_000_000n), o, [], 0).ok).toBe(true)
  })
})

describe("rule strategy", () => {
  it("steps three ticks above clearing, capped at the mandate max", () => {
    const d = ruleStrategy.decide(base()) as Decision
    expect(d).toMatchObject({ action: "bid", maxPerUnit: String(7_500_000n + 3n * 75_001n), moveTo: "fish_dock" })
    expect(d.reason.length).toBeLessThanOrEqual(80)
    const near = ruleStrategy.decide(base({ lot: { clearingPerUnit: 9_300_000n } })) as Decision
    expect(near.maxPerUnit).toBe("9400000")
  })
  it("passes with a reason when it should not bid", () => {
    expect(ruleStrategy.decide(base({ lot: { clearingPerUnit: 9_400_000n } }))).toMatchObject({ action: "pass" })
    expect(ruleStrategy.decide(base({ myBestOnLot: 8_000_000n }))).toMatchObject({ action: "pass", reason: "Still winning at my last bid" })
    expect(ruleStrategy.decide(base({ lot: { sellerName: "Coastal Catch", sellerRecord: { cleanLots: 0, noShows: 1, proven: false } } }))).toEqual({
      action: "pass",
      reason: "Coastal Catch has a recent no-show",
    })
  })
})
