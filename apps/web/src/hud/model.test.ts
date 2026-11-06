import { LOT_STATUS, type LotStatus } from "@fairtown/shared/keys"
import type { TownEvent } from "@fairtown/shared/protocol"
import { describe, expect, it } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { BUYER, SAMPLE_EVENTS as S, SELLER, TRUCK } from "../test/samples"
import { TIMELINE_STEPS, buildingSummary, tickerLine, timelineSteps, worldClock } from "./model"

const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const FIXTURE_START = Date.UTC(2026, 10, 6, 4, 0)

describe("worldClock", () => {
  it("shows local time in Bergen, Dallas, Mumbai and the data centre", () => {
    const rows = worldClock(initialTownState, FIXTURE_START)
    expect(rows.map((r) => [r.city, r.time])).toEqual([
      ["Bergen", "05:00"],
      ["Dallas", "22:00"],
      ["Mumbai", "09:30"],
      ["Data centre", "04:00"],
    ])
  })

  it("counts down to the next expiry among open lots in that place", () => {
    const s = { ...run([S["lot.listed"], { ...S["lot.listed"], lotId: "13", endBlock: 1100 }]), block: 1000 }
    const bergen = worldClock(s, FIXTURE_START)[0]!
    expect(bergen.nextExpiry).toEqual({ lotId: "12", label: "1:30" })
    expect(worldClock(s, FIXTURE_START)[1]!.nextExpiry).toBeNull()
  })

  it("ignores lots that are no longer open", () => {
    const s = run([S["lot.listed"], S["lot.settled"]])
    expect(worldClock(s, FIXTURE_START)[0]!.nextExpiry).toBeNull()
  })
})

describe("timelineSteps", () => {
  const listed = () => run([S["lot.listed"]])
  const lotAt = (status: LotStatus, extra: TownEvent[] = []) => {
    const s = run(extra, listed())
    return { ...s.lots["12"]!, status }
  }

  it("has the five steps in order", () => {
    expect(TIMELINE_STEPS).toEqual(["Sold", "Truck booked", "Picked up", "Delivered", "Paid in full"])
  })

  it.each(LOT_STATUS)("renders a lot in status %s", (status) => {
    const steps = timelineSteps(lotAt(status))
    expect(steps.steps).toHaveLength(5)
  })

  it("marks steps done as the lot moves, with the current step and its deadline", () => {
    const s = run([S["lot.settled"], S["carrier.assigned"]], listed())
    const t = timelineSteps(s.lots["12"]!)
    expect(t.steps.map((x) => x.state)).toEqual(["done", "done", "current", "pending", "pending"])
    expect(t.steps[0]!.tx).toBe(S["lot.settled"].tx)
    expect(t.steps[2]!.deadlineBlock).toBe(1200)
    expect(t.refunded).toBeNull()
  })

  it("is all done when paid in full", () => {
    const s = run(
      [S["lot.settled"], S["carrier.assigned"], S["handover.confirmed"], S["lot.delivered"], S["lot.paid_in_full"]],
      listed(),
    )
    const t = timelineSteps(s.lots["12"]!)
    expect(t.steps.every((x) => x.state === "done")).toBe(true)
    expect(t.steps[2]!.tx).toBe(S["handover.confirmed"].tx)
  })

  it("shows nothing done while the auction is open", () => {
    expect(timelineSteps(listed().lots["12"]!).steps.map((x) => x.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ])
  })

  it("branches red to Refunded after a no-show, keeping what was done", () => {
    const s = run([S["lot.settled"], S["noshow.reported"], S["noshow.refunded"]], listed())
    const t = timelineSteps(s.lots["12"]!)
    expect(t.refunded).toEqual({ reason: "no_show", label: "Refunded: seller did not hand over" })
    expect(t.steps[0]!.state).toBe("done")
    expect(t.steps[2]!.state).toBe("pending")
  })

  it("branches to Refunded after a dispute", () => {
    const s = run([S["lot.settled"], S["dispute.opened"], S["dispute.resolved"]], listed())
    expect(timelineSteps(s.lots["12"]!).refunded).toEqual({
      reason: "dispute",
      label: "Refunded: 25% refund after a dispute",
    })
  })

  it("flags a reported no-show on the current step", () => {
    const s = run([S["lot.settled"], S["noshow.reported"]], listed())
    const t = timelineSteps(s.lots["12"]!)
    expect(t.steps[1]).toMatchObject({ state: "current", alert: "No-show reported", deadlineBlock: 1500 })
  })

  it("lets the API timeline fill in blocks and txs", () => {
    const s = run([S["lot.settled"]], listed())
    const api = [{ name: "Truck booked", status: "done", block: 1060, tx: `0x${"cd".repeat(32)}` }]
    const t = timelineSteps(s.lots["12"]!, api)
    expect(t.steps[1]).toMatchObject({ state: "done", block: 1060, tx: `0x${"cd".repeat(32)}` })
  })
})

describe("tickerLine", () => {
  const town = run([
    S["lot.listed"],
    S["agent.spawned"],
    { ...S["agent.spawned"], agentId: TRUCK, name: "Lars", role: "TRUCK", building: "freight_yard" },
  ])

  it.each([
    [S["bid.placed"], "Hanse Kitchen bid €9.40/kg on Lot 12"],
    [S["lot.listed"], "Ingrid Solheim listed 600 kg cod at €7.50/kg (Lot 12)"],
    [S["lot.settled"], "Lot 12 sold, average €9.10/kg"],
    [S["carrier.assigned"], "Lars will carry Lot 12"],
    [S["handover.confirmed"], "Lot 12 picked up, €2,702.70 released to the seller"],
    [S["lot.paid_in_full"], "Lot 12 paid in full"],
    [S["noshow.reported"], "Hanse Kitchen reported a no-show on Lot 12"],
    [S["noshow.refunded"], "€2,702.70 refunded to Hanse Kitchen on Lot 12"],
    [S["dispute.resolved"], "Dispute on Lot 12 closed: 25% refund"],
    [S["human.joined"], "Priya walked into town"],
    [S.signal, "Storm forecast"],
  ] as const)("%o reads %s", (event, line) => {
    expect(tickerLine(town, event)).toBe(line)
  })

  it("stays quiet for events with nothing to say", () => {
    expect(tickerLine(town, S["fx.updated"])).toBeNull()
    expect(tickerLine(town, S.clock)).toBeNull()
  })

  it("falls back to a short address for an unknown agent", () => {
    expect(tickerLine(initialTownState, { ...S["bid.placed"], lotId: "99" })).toBe(`0x0000…00b2 bid on Lot 99`)
  })
})

describe("buildingSummary", () => {
  it("lists open lots, recent clears and the reference", () => {
    const s = run([S["lot.listed"], { ...S["lot.listed"], lotId: "13" }, S["lot.settled"], S["reference.updated"]])
    const b = buildingSummary(s, "fish_dock")
    expect(b.open.map((l) => l.lotId)).toEqual(["13"])
    expect(b.clears.map((l) => l.lotId)).toEqual(["12"])
    expect(b.references).toEqual([
      { commodity: "cod", perUnit: "8300000", currency: "EUR", source: "Fiskeridirektoratet" },
    ])
  })

  it("is empty for a quiet building", () => {
    expect(buildingSummary(initialTownState, "cold_vault")).toEqual({ open: [], clears: [], references: [] })
  })
})

describe("reducer progress (for the timeline)", () => {
  it("remembers the furthest step a lot reached", () => {
    const s = run([S["lot.listed"], S["lot.settled"], S["carrier.assigned"], S["noshow.reported"]])
    expect(s.lots["12"]?.progress).toBe(2)
  })

  it("records why a lot was refunded", () => {
    expect(run([S["lot.listed"], S["noshow.refunded"]]).lots["12"]?.refundReason).toBe("no_show")
    expect(run([S["lot.listed"], S["dispute.resolved"]]).lots["12"]?.refundReason).toBe("dispute")
  })
})

void BUYER
void SELLER
