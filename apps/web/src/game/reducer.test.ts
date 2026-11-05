import { TOWN_EVENT_TYPES, type TownEvent, type TownSnapshot } from "@fairtown/shared/protocol"
import { describe, expect, it } from "vitest"
import { BUYER, SAMPLE_EVENTS as S, SELLER, TRUCK, emptySnapshot, envelope } from "../test/samples"
import { COMMAND_KINDS, type TownCommand } from "./commands"
import { commandsForState, hydrate, initialTownState, reduce, reduceEnvelope, type TownState } from "./reducer"

const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)

/** Lot 12 listed at Fish Dock (slot 1) and Hanse Kitchen in town. */
const seeded = () => run([S["lot.listed"], S["agent.spawned"]])

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze)
    Object.freeze(o)
  }
  return o
}

type Case = { from: () => TownState; commands: TownCommand[]; state?: (s: TownState) => void }
const lot12 = (s: TownState) => s.lots["12"]!

const CASES: { [K in TownEvent["type"]]: Case } = {
  "lot.listed": {
    from: () => initialTownState,
    commands: [
      {
        kind: "placeStall",
        lotId: "12",
        building: "fish_dock",
        slot: 1,
        commodity: "cod",
        qty: 600,
        unit: "kg",
        floorLabel: "€7.50/kg",
        endBlock: 1045,
        seller: SELLER,
      },
      { kind: "setStatus", lotId: "12", status: "open" },
    ],
    state: (s) => expect(lot12(s)).toMatchObject({ status: "open", slot: 1, bids: 0, sellerName: "Ingrid Solheim" }),
  },
  "agent.spawned": {
    from: () => initialTownState,
    commands: [
      {
        kind: "spawnAgent",
        agentId: BUYER,
        label: "Hanse Kitchen",
        role: "BUYER",
        building: "fish_dock",
        sprite: "chef",
        highlight: false,
      },
    ],
    state: (s) => expect(s.agents[BUYER]).toMatchObject({ name: "Hanse Kitchen", building: "fish_dock" }),
  },
  "agent.intent": {
    from: seeded,
    commands: [
      { kind: "walkTo", agentId: BUYER, building: "fish_dock" },
      { kind: "showBubble", agentId: BUYER, text: "Grade A cod, storm tomorrow, capping at €9.40/kg" },
    ],
  },
  "bid.placed": {
    from: seeded,
    commands: [
      { kind: "coinArc", lotId: "12", agentId: BUYER },
      { kind: "tickPrice", lotId: "12", bids: 1 },
    ],
    state: (s) => expect(lot12(s).bids).toBe(1),
  },
  "price.tick": {
    from: seeded,
    commands: [{ kind: "tickPrice", lotId: "12", priceLabel: "€8.10/kg", bids: 0 }],
    state: (s) => expect(lot12(s).clearingPerUnit).toBe("8100000"),
  },
  "lot.settled": {
    from: seeded,
    commands: [
      { kind: "flashClear", lotId: "12" },
      { kind: "toast", text: "€2,702.70 received, €2,702.70 at handover", tone: "money" },
      { kind: "setStatus", lotId: "12", status: "sold", deadlineBlock: 1200 },
    ],
    state: (s) =>
      expect(lot12(s)).toMatchObject({
        status: "sold",
        avgPerUnit: "9100000",
        clearingPerUnit: "9000000",
        pickupDeadline: 1200,
      }),
  },
  "lot.relisted": {
    from: seeded,
    commands: [
      { kind: "fadeStall", lotId: "12", newFloorLabel: "€6.375/kg" },
      { kind: "setStatus", lotId: "12", status: "relisted" },
    ],
    state: (s) => expect(lot12(s)).toMatchObject({ status: "relisted", slot: null }),
  },
  "transport.needed": {
    from: seeded,
    commands: [{ kind: "toast", text: "Truck needed: 600 kg from Bergen", tone: "info" }],
  },
  "storage.needed": {
    from: seeded,
    commands: [
      { kind: "openVault", lotId: "12" },
      { kind: "walkTo", agentId: BUYER, building: "cold_vault" },
      { kind: "toast", text: "Cold storage needed: 3000 kg for 2 days", tone: "info" },
    ],
  },
  "carrier.assigned": {
    from: seeded,
    commands: [
      { kind: "driveTruck", lotId: "12", from: "freight_yard", to: "fish_dock" },
      { kind: "setStatus", lotId: "12", status: "truck_booked" },
    ],
    state: (s) => expect(lot12(s).status).toBe("truck_booked"),
  },
  "handover.confirmed": {
    from: seeded,
    commands: [
      { kind: "moveCrate", lotId: "12", from: "fish_dock", to: "truck" },
      { kind: "toast", text: "€2,702.70 rest received", tone: "money" },
      { kind: "setStatus", lotId: "12", status: "picked_up" },
    ],
    state: (s) => expect(lot12(s).status).toBe("picked_up"),
  },
  "lot.delivered": {
    from: seeded,
    commands: [
      { kind: "driveTruck", lotId: "12", from: "fish_dock", to: "freight_yard" },
      { kind: "setStatus", lotId: "12", status: "delivered" },
    ],
    state: (s) => expect(lot12(s).status).toBe("delivered"),
  },
  "lot.paid_in_full": {
    from: seeded,
    commands: [{ kind: "setStatus", lotId: "12", status: "paid_in_full" }],
    state: (s) => expect(lot12(s)).toMatchObject({ status: "paid_in_full", slot: null }),
  },
  "noshow.reported": {
    from: seeded,
    commands: [
      { kind: "setStatus", lotId: "12", status: "no_show_reported", deadlineBlock: 1500 },
      { kind: "toast", text: "Buyer reported a no-show on Lot 12", tone: "warn" },
    ],
    state: (s) => expect(lot12(s)).toMatchObject({ status: "no_show_reported", deadlineBlock: 1500 }),
  },
  "noshow.contested": {
    from: seeded,
    commands: [
      { kind: "setStatus", lotId: "12", status: "disputed" },
      { kind: "toast", text: "Seller contested the no-show on Lot 12", tone: "info" },
    ],
  },
  "noshow.refunded": {
    from: seeded,
    commands: [
      { kind: "refundCoins", lotId: "12", buyer: BUYER, amountLabel: "€2,702.70" },
      { kind: "setStatus", lotId: "12", status: "refunded" },
      { kind: "signNoShow", lotId: "12", seller: SELLER },
      { kind: "toast", text: "€2,702.70 returned to the buyer on Lot 12", tone: "warn" },
    ],
    state: (s) => expect(lot12(s)).toMatchObject({ status: "refunded", slot: null }),
  },
  "seller.record": {
    from: seeded,
    commands: [{ kind: "markSeller", seller: SELLER, tier: "proven", cleanLots: 3, noShows: 0 }],
    state: (s) => expect(s.sellers[SELLER]).toEqual({ cleanLots: 3, noShows: 0, proven: true }),
  },
  "dispute.opened": {
    from: seeded,
    commands: [
      { kind: "inspect", lotId: "12" },
      { kind: "setStatus", lotId: "12", status: "disputed" },
      { kind: "toast", text: "Dispute opened on Lot 12", tone: "warn" },
    ],
  },
  "dispute.resolved": {
    from: seeded,
    commands: [
      { kind: "toast", text: "Dispute on Lot 12 resolved: 25% refund", tone: "info" },
      { kind: "refundBadge", lotId: "12", label: "25% refund" },
      { kind: "setStatus", lotId: "12", status: "refunded" },
    ],
  },
  signal: {
    from: seeded,
    commands: [{ kind: "setWeather", place: "bergen", weather: "storm", severity: 3, label: "Storm forecast" }],
    state: (s) => expect(s.signals["sig-1"]?.label).toBe("Storm forecast"),
  },
  "reference.updated": {
    from: seeded,
    commands: [
      { kind: "plaque", building: "fish_dock", text: "Reference €8.30" },
      { kind: "toast", text: "Reference price for cod: €8.30", tone: "info" },
    ],
    state: (s) =>
      expect(s.references["cod@fish_dock"]).toEqual({
        perUnit: "8300000",
        currency: "EUR",
        source: "Fiskeridirektoratet",
      }),
  },
  "fx.updated": {
    from: seeded,
    commands: [],
    state: (s) => expect(s.fx.INR).toBe(84),
  },
  "human.joined": {
    from: seeded,
    commands: [
      {
        kind: "spawnAgent",
        agentId: "0x00000000000000000000000000000000000000e5",
        label: "Priya",
        role: "HUMAN",
        building: "town_gate",
        sprite: "human",
        highlight: true,
      },
    ],
  },
  clock: {
    from: seeded,
    commands: [
      { kind: "setPhase", phase: "night" },
      { kind: "setLights", on: true },
    ],
    state: (s) => expect(s).toMatchObject({ block: 1100, phase: "night" }),
  },
}

describe("reduce: every relay event", () => {
  it("has a case for every TownEvent type and nothing else", () => {
    expect(Object.keys(CASES).sort()).toEqual([...TOWN_EVENT_TYPES].sort())
  })

  it.each(TOWN_EVENT_TYPES)("%s emits the expected commands and state", (type) => {
    const c = CASES[type]
    const before = deepFreeze(c.from())
    const { state, commands } = reduce(before, S[type])
    expect(commands).toEqual(c.commands)
    c.state?.(state)
  })

  it("only emits known command kinds", () => {
    const seen = TOWN_EVENT_TYPES.flatMap((t) => reduce(CASES[t].from(), S[t]).commands.map((c) => c.kind))
    for (const k of seen) expect(COMMAND_KINDS).toContain(k)
    expect(COMMAND_KINDS).toHaveLength(23)
  })
})

describe("reduce: edge cases", () => {
  it("handles a settled lot it never saw listed, without money labels or a stall", () => {
    const { state, commands } = reduce(initialTownState, { ...S["lot.settled"], lotId: "99" })
    expect(commands).toEqual([
      { kind: "toast", text: "Lot 99 sold", tone: "money" },
      { kind: "setStatus", lotId: "99", status: "sold", deadlineBlock: 1200 },
    ])
    expect(state.lots["99"]).toBeUndefined()
  })

  it("ignores bids and price ticks for an unknown lot", () => {
    expect(reduce(initialTownState, { ...S["bid.placed"], lotId: "99" }).commands).toEqual([])
    expect(reduce(initialTownState, { ...S["price.tick"], lotId: "99" }).commands).toEqual([])
  })

  it("confirms a handover for an unknown lot without a crate move or money", () => {
    expect(reduce(initialTownState, { ...S["handover.confirmed"], lotId: "99" }).commands).toEqual([
      { kind: "toast", text: "Lot 99 picked up", tone: "money" },
      { kind: "setStatus", lotId: "99", status: "picked_up" },
    ])
  })

  it("leaves money out of labels when the lot currency is not one we settle in", () => {
    const odd = run([{ ...S["lot.listed"], currency: "GBP" }])
    expect(reduce(odd, S["lot.settled"]).commands[1]).toEqual({ kind: "toast", text: "Lot 12 sold", tone: "money" })
  })

  it("moves the crate to the buyer when the buyer scans directly", () => {
    const { commands } = reduce(seeded(), { ...S["handover.confirmed"], receiver: BUYER })
    expect(commands[0]).toEqual({ kind: "moveCrate", lotId: "12", from: "fish_dock", to: "buyer" })
  })

  it("never shares a stall slot: the 7th lot in a building waits with slot null", () => {
    const lots = Array.from({ length: 7 }, (_, i) => ({ ...S["lot.listed"], lotId: String(100 + i) }))
    const slots = lots.reduce<{ s: TownState; out: (number | null)[] }>(
      (acc, e) => {
        const r = reduce(acc.s, e)
        const place = r.commands.find((c) => c.kind === "placeStall")
        return { s: r.state, out: [...acc.out, place?.kind === "placeStall" ? place.slot : -1] }
      },
      { s: initialTownState, out: [] },
    ).out
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, null])
  })

  it("reuses a slot freed by paid in full", () => {
    const lots = Array.from({ length: 6 }, (_, i) => ({ ...S["lot.listed"], lotId: String(100 + i) }))
    const full = run([...lots, { type: "lot.paid_in_full", lotId: "102" }])
    const { commands } = reduce(full, { ...S["lot.listed"], lotId: "200" })
    expect(commands[0]).toMatchObject({ kind: "placeStall", slot: 3 })
  })

  it("keeps slots per building", () => {
    const s = run([S["lot.listed"]])
    const { commands } = reduce(s, { ...S["lot.listed"], lotId: "30", building: "flower_hall" })
    expect(commands[0]).toMatchObject({ kind: "placeStall", building: "flower_hall", slot: 1 })
  })

  it("cuts a long reason to an 80-character bubble", () => {
    const { commands } = reduce(seeded(), { ...S["agent.intent"], reason: "x".repeat(200) })
    const bubble = commands.find((c) => c.kind === "showBubble")
    expect(bubble?.kind === "showBubble" && bubble.text).toHaveLength(80)
    expect(bubble?.kind === "showBubble" && bubble.text.endsWith("…")).toBe(true)
  })

  it("walks to moveTo when an intent names a building", () => {
    const { commands } = reduce(seeded(), { ...S["agent.intent"], lotId: undefined, moveTo: "flower_hall" })
    expect(commands[0]).toEqual({ kind: "walkTo", agentId: BUYER, building: "flower_hall" })
  })

  it("only shows a bubble when an intent has no known destination", () => {
    const { commands } = reduce(seeded(), { ...S["agent.intent"], lotId: "99" })
    expect(commands.map((c) => c.kind)).toEqual(["showBubble"])
  })

  it("labels the ensName when an agent has one", () => {
    const { commands } = reduce(initialTownState, { ...S["agent.spawned"], ensName: "hanse.fairtown.eth" })
    expect(commands[0]).toMatchObject({ label: "hanse.fairtown.eth" })
  })

  it("closes a dispute with no refund without changing status", () => {
    const { commands } = reduce(seeded(), { ...S["dispute.resolved"], refundBps: 0 })
    expect(commands).toEqual([
      { kind: "toast", text: "Dispute on Lot 12 resolved: no refund", tone: "info" },
      { kind: "refundBadge", lotId: "12", label: "No refund" },
    ])
  })

  it.each([
    ["festival", [{ kind: "setLights", on: true, place: "mumbai", label: "Diwali in 3 days" }]],
    ["demand_dip", [{ kind: "setWeather", place: "mumbai", weather: "quiet", severity: 1, label: "Diwali in 3 days" }]],
    ["reference", [{ kind: "toast", text: "Diwali in 3 days", tone: "info" }]],
  ] as const)("maps a %s signal", (kind, expected) => {
    const e = { ...S.signal, kind, place: "mumbai", severity: 1, label: "Diwali in 3 days" }
    expect(reduce(seeded(), e).commands).toEqual(expected)
  })

  it("turns lights off by day and only moves the block when a clock has no phase", () => {
    expect(reduce(seeded(), { type: "clock", block: 5, phase: "noon" }).commands).toEqual([
      { kind: "setPhase", phase: "noon" },
      { kind: "setLights", on: false },
    ])
    const r = reduce(seeded(), { type: "clock", block: 6 })
    expect(r.commands).toEqual([])
    expect(r.state.block).toBe(6)
  })
})

describe("hydrate and commandsForState", () => {
  const snapshot = (): TownSnapshot => ({
    ...emptySnapshot(),
    block: 1050,
    lots: [
      { ...S["lot.listed"], status: "open", bids: 4, clearingPerUnit: "8100000" },
      { ...S["lot.listed"], lotId: "13", status: "paid_in_full", bids: 2 },
    ],
    agents: [{ agentId: TRUCK, name: "Lars", role: "TRUCK", building: "freight_yard", sprite: "truck" }],
    signals: [S.signal],
    fx: { EUR: 0.92 },
  })

  it("builds state and redraw commands from a relay snapshot", () => {
    const { state, commands } = hydrate(snapshot())
    expect(state.block).toBe(1050)
    expect(state.lots["12"]).toMatchObject({ status: "open", bids: 4, slot: 1 })
    expect(state.lots["13"]).toMatchObject({ status: "paid_in_full", slot: null })
    expect(state.fx).toEqual({ EUR: 0.92 })
    expect(commands.filter((c) => c.kind === "placeStall")).toHaveLength(1)
    expect(commands.filter((c) => c.kind === "spawnAgent")).toHaveLength(1)
    expect(commands.filter((c) => c.kind === "setWeather")).toHaveLength(1)
  })

  it("redraws everything a late-mounting scene missed", () => {
    const s = run([S["lot.listed"], S["agent.spawned"], S["price.tick"], S.clock])
    const kinds = commandsForState(s).map((c) => c.kind)
    expect(kinds).toEqual(["setPhase", "setLights", "placeStall", "setStatus", "tickPrice", "spawnAgent"])
  })
})

describe("reduceEnvelope", () => {
  it("advances the clock from the envelope block before the event's commands", () => {
    const { state, commands } = reduceEnvelope(initialTownState, { ...envelope(S["lot.listed"]), block: 1050 })
    expect(state.block).toBe(1050)
    expect(commands.map((c) => c.kind)).toEqual(["setClock", "placeStall", "setStatus"])
    expect(commands[0]).toEqual({ kind: "setClock", block: 1050 })
  })

  it("never moves the clock backwards", () => {
    const at = reduceEnvelope(initialTownState, { ...envelope(S["fx.updated"]), block: 1050 }).state
    const { state, commands } = reduceEnvelope(at, { ...envelope(S["fx.updated"]), block: 1040 })
    expect(state.block).toBe(1050)
    expect(commands).toEqual([])
  })

  it("advances the clock from a clock event", () => {
    const { commands } = reduceEnvelope(initialTownState, envelope({ type: "clock", block: 1100 }))
    expect(commands).toEqual([{ kind: "setClock", block: 1100 }])
  })

  it("draws a seller's tier badge again on redraw", () => {
    const s = run([S["lot.listed"], S["seller.record"]])
    expect(commandsForState(s).at(-1)).toEqual({
      kind: "markSeller",
      seller: SELLER,
      tier: "proven",
      cleanLots: 3,
      noShows: 0,
    })
  })
})

describe("history for panels (S3 1.4)", () => {
  it("logs bids, prices, the settlement and the handover on the lot", () => {
    const s = run([S["lot.listed"], S["bid.placed"], S["price.tick"], S["lot.settled"], S["handover.confirmed"]])
    const lot = s.lots["12"]!
    expect(lot.bidLog).toEqual([
      { agentId: BUYER, maxPerUnit: "9400000", amount: "5460000000", tx: S["bid.placed"].tx },
    ])
    expect(lot.priceLog).toEqual([{ block: 0, perUnit: "8100000" }])
    expect(lot.settlement).toEqual({
      sellerPaid: "2702700000",
      held: "2702700000",
      fee: "54600000",
      advanceBps: 5000,
      soldUnits: "600",
      tx: S["lot.settled"].tx,
    })
    expect(lot.handoverTx).toBe(S["handover.confirmed"].tx)
  })

  it("links a relisted lot to its new lot", () => {
    expect(run([S["lot.listed"], S["lot.relisted"]]).lots["12"]?.relistedAs).toBe("13")
  })

  it("keeps the last 5 reasons per agent", () => {
    const intents = Array.from({ length: 7 }, (_, i) => ({ ...S["agent.intent"], reason: `reason ${i}` }))
    const s = run([S["agent.spawned"], ...intents])
    expect(s.agents[BUYER]?.reasons).toEqual(["reason 2", "reason 3", "reason 4", "reason 5", "reason 6"])
  })
})

describe("handover facts (S3 2.2)", () => {
  it("remembers the carrier, the sold units and who reported a no-show", () => {
    const s = run([S["lot.listed"], S["lot.settled"], S["carrier.assigned"], S["noshow.reported"]])
    const lot = s.lots["12"]!
    expect(lot.carrier).toBe(TRUCK)
    expect(lot.settlement?.soldUnits).toBe("600")
    expect(lot.noShowBuyer).toBe(BUYER)
  })
})
