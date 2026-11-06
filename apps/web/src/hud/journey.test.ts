import type { LotStatus } from "@fairtown/shared/keys"
import { describe, expect, it } from "vitest"
import type { LotState } from "../game/reducer"
import { JOURNEY, journeySteps, spotlightLot } from "./journey"

const states = (status: LotStatus, progress: number) =>
  journeySteps({ status, progress }).map((s) => `${s.name}:${s.state}`)

const lot = (lotId: string, status: LotStatus) => ({ lotId, status, progress: 0 }) as unknown as LotState
const lotsOf = (...ls: LotState[]) => Object.fromEntries(ls.map((l) => [l.lotId, l]))

describe("journeySteps", () => {
  it("names the seven steps in order", () => {
    expect(journeySteps({ status: "open", progress: 0 }).map((s) => s.name)).toEqual([...JOURNEY])
  })
  it("an open lot is listed, in auction, and nothing after", () => {
    expect(states("open", 0)).toEqual([
      "Listed:done",
      "Auction:current",
      "Sold:pending",
      "Truck:pending",
      "Picked up:pending",
      "Delivered:pending",
      "Paid:pending",
    ])
  })
  it("a sold lot waits on its truck", () => {
    expect(states("sold", 1)).toEqual([
      "Listed:done",
      "Auction:done",
      "Sold:done",
      "Truck:current",
      "Picked up:pending",
      "Delivered:pending",
      "Paid:pending",
    ])
  })
  it("a lot paid in full has every step done", () => {
    expect(journeySteps({ status: "paid_in_full", progress: 5 }).every((s) => s.state === "done")).toBe(true)
  })
  it("a relisted lot flags its auction as unsold", () => {
    const auction = journeySteps({ status: "relisted", progress: 0 })[1]!
    expect(auction).toEqual({ name: "Auction", state: "alert", note: "Unsold, relisted" })
  })
  it("a no-show, dispute or refund flags the step the lot stopped at", () => {
    expect(journeySteps({ status: "no_show_reported", progress: 1 })[3]).toEqual({
      name: "Truck",
      state: "alert",
      note: "No-show reported",
    })
    expect(journeySteps({ status: "disputed", progress: 3 })[5]).toMatchObject({ state: "alert", note: "Disputed" })
    expect(journeySteps({ status: "refunded", progress: 2 })[4]).toMatchObject({ state: "alert", note: "Refunded" })
  })
  it("clamps a progress outside 0 to 5", () => {
    expect(states("paid_in_full", 9)).toEqual(states("paid_in_full", 5))
    expect(states("open", -3)).toEqual(states("open", 0))
  })
})

describe("spotlightLot", () => {
  it("follows the selected lot", () => {
    const lots = lotsOf(lot("1", "open"), lot("2", "sold"))
    expect(spotlightLot(lots, { kind: "lot", id: "2" })).toBe("2")
  })
  it("ignores a selection that is not a known lot", () => {
    const lots = lotsOf(lot("1", "open"))
    expect(spotlightLot(lots, { kind: "lot", id: "99" })).toBe("1")
    expect(spotlightLot(lots, { kind: "agent", id: "1" })).toBe("1")
  })
  it("otherwise picks the newest open auction", () => {
    const lots = lotsOf(lot("1", "open"), lot("2", "open"), lot("3", "sold"))
    expect(spotlightLot(lots, null)).toBe("2")
  })
  it("with no auction open, the newest lot still under way", () => {
    const lots = lotsOf(lot("1", "truck_booked"), lot("2", "paid_in_full"))
    expect(spotlightLot(lots, null)).toBe("1")
  })
  it("with every lot finished, the newest; with no lots, nothing", () => {
    expect(spotlightLot(lotsOf(lot("1", "paid_in_full"), lot("2", "relisted")), null)).toBe("2")
    expect(spotlightLot({}, null)).toBeUndefined()
  })
})
