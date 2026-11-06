import { CURRENCIES, type Building, type Currency } from "@fairtown/shared/keys"
import type { TownEvent } from "@fairtown/shared/protocol"
import type { LotState, TownState } from "../game/reducer"
import { countdown } from "../game/market/slots"
import { formatBps, formatMoney, formatPerUnit } from "../money/format"

/** Pure view models for the HUD (S3 1.4). Every figure comes from relay state or the API. */

export const asCurrency = (c: string): Currency | undefined =>
  (CURRENCIES as readonly string[]).includes(c) ? (c as Currency) : undefined
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

export const CLOCKS = [
  { id: "bergen", city: "Bergen", timeZone: "Europe/Oslo", places: ["bergen", "oslo", "hamburg"] },
  { id: "dallas", city: "Dallas", timeZone: "America/Chicago", places: ["dallas", "houston"] },
  { id: "mumbai", city: "Mumbai", timeZone: "Asia/Kolkata", places: ["mumbai", "pune"] },
  { id: "dc", city: "Data centre", timeZone: "UTC", places: ["any_dc"] },
] as const

export type ClockRow = { id: string; city: string; time: string; nextExpiry: { lotId: string; label: string } | null }

/** Local time per city at `ts` (replay or live envelope time) and the next open lot to expire there. */
export function worldClock(state: TownState, ts: number): ClockRow[] {
  return CLOCKS.map((c) => {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: c.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(ts)
    const next = Object.values(state.lots)
      .filter(
        (l) => l.status === "open" && (c.places as readonly string[]).includes(l.place) && l.endBlock > state.block,
      )
      .sort((a, b) => a.endBlock - b.endBlock)[0]
    return {
      id: c.id,
      city: c.city,
      time,
      nextExpiry: next ? { lotId: next.lotId, label: countdown(next.endBlock, state.block) } : null,
    }
  })
}

export const TIMELINE_STEPS = ["Sold", "Truck booked", "Picked up", "Delivered", "Paid in full"] as const
export type StepState = "done" | "current" | "pending"
export type TimelineStep = {
  name: (typeof TIMELINE_STEPS)[number]
  state: StepState
  block?: number
  tx?: string
  deadlineBlock?: number
  alert?: string
}
export type Timeline = { steps: TimelineStep[]; refunded: { reason: "no_show" | "dispute"; label: string } | null }
export type ApiStep = { name: string; status: string; block?: number; tx?: string; deadlineBlock?: number }

/** The five-step timeline with a red Refunded branch, from relay state, filled in by `GET /api/lots/:id/timeline`. */
export function timelineSteps(lot: LotState, api: ApiStep[] = []): Timeline {
  const live = lot.progress > 0 && lot.progress < 5 && lot.status !== "refunded"
  const steps = TIMELINE_STEPS.map((name, i): TimelineStep => {
    const step: TimelineStep = {
      name,
      state: i < lot.progress ? "done" : i === lot.progress && live ? "current" : "pending",
    }
    if (i === 0 && lot.settlement) step.tx = lot.settlement.tx
    if (i === 2 && lot.handoverTx) step.tx = lot.handoverTx
    if (step.state === "current" && lot.deadlineBlock !== undefined) step.deadlineBlock = lot.deadlineBlock
    if (step.state === "current" && lot.status === "no_show_reported") step.alert = "No-show reported"
    if (step.state === "current" && lot.status === "disputed") step.alert = "Disputed"
    const fromApi = api.find((a) => a.name === name)
    if (fromApi) {
      if (fromApi.status === "done") step.state = "done"
      if (fromApi.block !== undefined) step.block = fromApi.block
      if (fromApi.tx) step.tx = fromApi.tx
      if (fromApi.deadlineBlock !== undefined && step.state !== "done") step.deadlineBlock = fromApi.deadlineBlock
    }
    return step
  })
  let refunded: Timeline["refunded"] = null
  if (lot.status === "refunded") {
    refunded =
      lot.refundReason === "dispute"
        ? { reason: "dispute", label: `Refunded: ${formatBps(lot.refundBps ?? 0)} refund after a dispute` }
        : { reason: "no_show", label: "Refunded: seller did not hand over" }
  }
  return { steps, refunded }
}

export const nameOf = (state: TownState, id: string) =>
  state.agents[id]?.ensName ?? state.agents[id]?.name ?? shortAddress(id)
export const lotMoney = (lot: LotState | undefined, base: string) => {
  const c = lot && asCurrency(lot.currency)
  return c ? formatMoney(BigInt(base), c) : undefined
}
export const lotPerUnit = (lot: LotState | undefined, base: string) => {
  const c = lot && asCurrency(lot.currency)
  return c && lot ? formatPerUnit(BigInt(base), c, lot.unit) : undefined
}

/** One plain-words ticker line for an event, read against the town before the event. Null when there is nothing to say. */
export function tickerLine(state: TownState, event: TownEvent): string | null {
  const lot = "lotId" in event && typeof event.lotId === "string" ? state.lots[event.lotId] : undefined
  switch (event.type) {
    case "bid.placed": {
      const price = lotPerUnit(lot, event.maxPerUnit)
      return `${nameOf(state, event.agentId)} bid ${price ? `${price} ` : ""}on Lot ${event.lotId}`
    }
    case "lot.listed": {
      const c = asCurrency(event.currency)
      const floor = c ? ` at ${formatPerUnit(BigInt(event.floorPerUnit), c, event.unit)}` : ""
      return `${event.sellerName} listed ${event.qty} ${event.unit} ${event.commodity}${floor} (Lot ${event.lotId})`
    }
    case "lot.settled": {
      const avg = lotPerUnit(lot, event.avgPerUnit)
      return `Lot ${event.lotId} sold${avg ? `, average ${avg}` : ""}`
    }
    case "carrier.assigned":
      return `${nameOf(state, event.carrier)} will carry Lot ${event.lotId}`
    case "handover.confirmed": {
      const rest = lotMoney(lot, event.releasedToSeller)
      return `Lot ${event.lotId} picked up${rest ? `, ${rest} released to the seller` : ""}`
    }
    case "lot.delivered":
      return `Lot ${event.lotId} delivered`
    case "lot.paid_in_full":
      return `Lot ${event.lotId} paid in full`
    case "noshow.reported":
      return `${nameOf(state, event.buyer)} reported a no-show on Lot ${event.lotId}`
    case "noshow.refunded": {
      const refund = lotMoney(lot, event.refund)
      return `${refund ?? "Held money"} refunded to ${nameOf(state, event.buyer)} on Lot ${event.lotId}`
    }
    case "dispute.opened":
      return `${nameOf(state, event.buyer)} opened a dispute on Lot ${event.lotId}`
    case "dispute.resolved":
      return `Dispute on Lot ${event.lotId} closed: ${event.refundBps > 0 ? `${formatBps(event.refundBps)} refund` : "no refund"}`
    case "lot.relisted":
      return `Lot ${event.lotId} relisted as Lot ${event.newLotId}`
    case "human.joined":
      return `${event.name} walked into town`
    case "signal":
      return event.label
    default:
      return null
  }
}

export type BuildingSummary = {
  open: LotState[]
  clears: LotState[]
  references: { commodity: string; perUnit: string; currency: string; source: string }[]
}

/** What a building panel lists: its open lots, its last 5 clears and its reference prices. */
export function buildingSummary(state: TownState, building: Building): BuildingSummary {
  const lots = Object.values(state.lots).filter((l) => l.building === building)
  const references = Object.entries(state.references)
    .filter(([key]) => key.endsWith(`@${building}`))
    .map(([key, r]) => ({ commodity: key.split("@")[0]!, ...r }))
  return {
    open: lots.filter((l) => l.status === "open"),
    clears: lots.filter((l) => l.settlement).slice(-5),
    references,
  }
}

/** Lot status in plain words, for sellers and panels. */
export const STATUS_WORDS: Record<string, string> = {
  open: "Open",
  unsold: "Not sold",
  sold: "Sold",
  truck_booked: "Truck booked",
  picked_up: "Picked up",
  delivered: "Delivered",
  paid_in_full: "Paid in full",
  no_show_reported: "No-show reported",
  disputed: "Being checked",
  refunded: "Refunded",
  relisted: "Listed again",
}
