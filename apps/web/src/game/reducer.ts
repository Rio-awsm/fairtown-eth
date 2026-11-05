import { CURRENCIES, type Building, type Currency, type LotStatus, type Role } from "@fairtown/shared/keys"
import type { LotListedEvent, SignalEvent, TownEvent, TownSnapshot } from "@fairtown/shared/protocol"
import { formatBps, formatMoney, formatPerUnit } from "../money/format"
import { BUBBLE_MAX, type Phase, type TownCommand } from "./commands"

export type LotState = LotListedEvent & {
  status: LotStatus
  slot: number | null
  bids: number
  clearingPerUnit?: string
  avgPerUnit?: string
  pickupDeadline?: number
  deadlineBlock?: number
}
export type AgentState = {
  agentId: string
  name: string
  role: Role
  building: Building
  sprite: string
  ensName?: string
  human: boolean
}
export type SellerState = { cleanLots: number; noShows: number; proven: boolean }
export type ReferenceState = { perUnit: string; currency: string; source: string }

export type TownState = {
  block: number
  phase?: Phase
  lots: Record<string, LotState>
  agents: Record<string, AgentState>
  sellers: Record<string, SellerState>
  signals: Record<string, SignalEvent>
  fx: Record<string, number>
  references: Record<string, ReferenceState>
}

export type ReduceResult = { state: TownState; commands: TownCommand[] }

export const SLOTS_PER_BUILDING = 6
/** Statuses that give the stall slot back. */
const FREES_SLOT: ReadonlySet<LotStatus> = new Set(["paid_in_full", "refunded", "relisted", "unsold"])

export const initialTownState: TownState = {
  block: 0,
  lots: {},
  agents: {},
  sellers: {},
  signals: {},
  fx: {},
  references: {},
}

const asCurrency = (c: string): Currency | undefined =>
  (CURRENCIES as readonly string[]).find((x) => x === c) as Currency | undefined
const money = (base: string, currency: string) => {
  const c = asCurrency(currency)
  return c ? formatMoney(BigInt(base), c) : undefined
}
const perUnit = (base: string, currency: string, unit: string) => {
  const c = asCurrency(currency)
  return c ? formatPerUnit(BigInt(base), c, unit) : undefined
}
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
const bubble = (s: string) => (s.length > BUBBLE_MAX ? `${s.slice(0, BUBBLE_MAX - 1)}…` : s)
const isNight = (p: Phase) => p === "evening" || p === "night"

function freeSlot(lots: Record<string, LotState>, building: Building, ignoreLotId?: string): number | null {
  const taken = new Set(
    Object.values(lots)
      .filter((l) => l.building === building && l.slot !== null && l.lotId !== ignoreLotId)
      .map((l) => l.slot),
  )
  for (let slot = 1; slot <= SLOTS_PER_BUILDING; slot++) if (!taken.has(slot)) return slot
  return null
}

function patchLot(state: TownState, lotId: string, patch: Partial<LotState>): TownState {
  const lot = state.lots[lotId]
  if (!lot) return state
  const next = { ...lot, ...patch }
  if (patch.status && FREES_SLOT.has(patch.status)) next.slot = null
  return { ...state, lots: { ...state.lots, [lotId]: next } }
}

const setStatus = (lotId: string, status: LotStatus, deadlineBlock?: number): TownCommand =>
  deadlineBlock === undefined
    ? { kind: "setStatus", lotId, status }
    : { kind: "setStatus", lotId, status, deadlineBlock }

function placeStall(lot: LotState): TownCommand {
  return {
    kind: "placeStall",
    lotId: lot.lotId,
    building: lot.building,
    slot: lot.slot,
    commodity: lot.commodity,
    qty: lot.qty,
    unit: lot.unit,
    floorLabel: perUnit(lot.floorPerUnit, lot.currency, lot.unit) ?? "",
    endBlock: lot.endBlock,
  }
}

function tickPrice(lot: LotState): TownCommand {
  const label = lot.clearingPerUnit ? perUnit(lot.clearingPerUnit, lot.currency, lot.unit) : undefined
  return label
    ? { kind: "tickPrice", lotId: lot.lotId, priceLabel: label, bids: lot.bids }
    : { kind: "tickPrice", lotId: lot.lotId, bids: lot.bids }
}

function spawnAgent(a: AgentState): TownCommand {
  return {
    kind: "spawnAgent",
    agentId: a.agentId,
    label: a.ensName ?? a.name,
    role: a.role,
    building: a.building,
    sprite: a.sprite,
    highlight: a.human,
  }
}

function signalCommands(s: SignalEvent): TownCommand[] {
  switch (s.kind) {
    case "weather":
      return [{ kind: "setWeather", place: s.place, weather: "storm", severity: s.severity, label: s.label }]
    case "festival":
      return [{ kind: "setLights", on: true, place: s.place, label: s.label }]
    case "demand_dip":
      return [{ kind: "setWeather", place: s.place, weather: "quiet", severity: s.severity, label: s.label }]
    case "reference":
      return [{ kind: "toast", text: s.label, tone: "info" }]
  }
}

const phaseCommands = (phase: Phase): TownCommand[] => [
  { kind: "setPhase", phase },
  { kind: "setLights", on: isNight(phase) },
]

/** Pure: `(TownState, TownEvent) => { state, commands }`. No Phaser, no I/O, never mutates its input. */
export function reduce(state: TownState, event: TownEvent): ReduceResult {
  const lot = "lotId" in event && typeof event.lotId === "string" ? state.lots[event.lotId] : undefined

  switch (event.type) {
    case "lot.listed": {
      const next: LotState = {
        ...event,
        status: "open",
        slot: freeSlot(state.lots, event.building, event.lotId),
        bids: 0,
      }
      return {
        state: { ...state, lots: { ...state.lots, [event.lotId]: next } },
        commands: [placeStall(next), setStatus(event.lotId, "open")],
      }
    }
    case "agent.spawned": {
      const agent: AgentState = {
        agentId: event.agentId,
        name: event.name,
        role: event.role,
        building: event.building,
        sprite: event.sprite,
        human: event.role === "HUMAN",
        ...(event.ensName ? { ensName: event.ensName } : {}),
      }
      return { state: { ...state, agents: { ...state.agents, [event.agentId]: agent } }, commands: [spawnAgent(agent)] }
    }
    case "agent.intent": {
      const target = event.moveTo ?? (event.lotId ? state.lots[event.lotId]?.building : undefined)
      const commands: TownCommand[] = target ? [{ kind: "walkTo", agentId: event.agentId, building: target }] : []
      commands.push({ kind: "showBubble", agentId: event.agentId, text: bubble(event.reason) })
      return { state, commands }
    }
    case "bid.placed": {
      if (!lot) return { state, commands: [] }
      const next = patchLot(state, event.lotId, { bids: lot.bids + 1 })
      return { state: next, commands: [tickPrice(next.lots[event.lotId]!)] }
    }
    case "price.tick": {
      if (!lot) return { state, commands: [] }
      const next = patchLot(state, event.lotId, { clearingPerUnit: event.clearingPerUnit })
      return { state: next, commands: [tickPrice(next.lots[event.lotId]!)] }
    }
    case "lot.settled": {
      const status = setStatus(event.lotId, "sold", event.pickupDeadline)
      const paid = lot && money(event.sellerPaid, lot.currency)
      const held = lot && money(event.held, lot.currency)
      const text = paid && held ? `${paid} received, ${held} at handover` : `Lot ${event.lotId} sold`
      if (!lot) return { state, commands: [{ kind: "toast", text, tone: "money" }, status] }
      return {
        state: patchLot(state, event.lotId, {
          status: "sold",
          clearingPerUnit: event.finalClearingPerUnit,
          avgPerUnit: event.avgPerUnit,
          pickupDeadline: event.pickupDeadline,
          deadlineBlock: event.pickupDeadline,
        }),
        commands: [{ kind: "flashClear", lotId: event.lotId }, { kind: "toast", text, tone: "money" }, status],
      }
    }
    case "lot.relisted": {
      const label = lot ? perUnit(event.newFloorPerUnit, lot.currency, lot.unit) : undefined
      return {
        state: patchLot(state, event.lotId, { status: "relisted" }),
        commands: [
          label
            ? { kind: "fadeStall", lotId: event.lotId, newFloorLabel: label }
            : { kind: "fadeStall", lotId: event.lotId },
          setStatus(event.lotId, "relisted"),
        ],
      }
    }
    case "transport.needed": {
      const unit = lot ? ` ${lot.unit}` : ""
      return {
        state,
        commands: [
          { kind: "toast", text: `Truck needed: ${event.qty}${unit} from ${titleCase(event.place)}`, tone: "info" },
        ],
      }
    }
    case "storage.needed": {
      const unit = lot ? ` ${lot.unit}` : ""
      const days = event.days === 1 ? "1 day" : `${event.days} days`
      return {
        state,
        commands: [{ kind: "toast", text: `Cold storage needed: ${event.qty}${unit} for ${days}`, tone: "info" }],
      }
    }
    case "carrier.assigned": {
      const commands: TownCommand[] = lot
        ? [{ kind: "driveTruck", lotId: event.lotId, from: "freight_yard", to: lot.building }]
        : []
      commands.push(setStatus(event.lotId, "truck_booked"))
      return { state: patchLot(state, event.lotId, { status: "truck_booked" }), commands }
    }
    case "handover.confirmed": {
      const rest = lot && money(event.releasedToSeller, lot.currency)
      const status = setStatus(event.lotId, "picked_up")
      const text = rest ? `${rest} rest received` : `Lot ${event.lotId} picked up`
      if (!lot) return { state, commands: [{ kind: "toast", text, tone: "money" }, status] }
      const to = event.receiver.toLowerCase() === event.buyer.toLowerCase() ? "buyer" : "truck"
      return {
        state: patchLot(state, event.lotId, { status: "picked_up" }),
        commands: [
          { kind: "moveCrate", lotId: event.lotId, from: lot.building, to },
          { kind: "toast", text, tone: "money" },
          status,
        ],
      }
    }
    case "lot.delivered": {
      const commands: TownCommand[] = lot
        ? [{ kind: "driveTruck", lotId: event.lotId, from: lot.building, to: "freight_yard" }]
        : []
      commands.push(setStatus(event.lotId, "delivered"))
      return { state: patchLot(state, event.lotId, { status: "delivered" }), commands }
    }
    case "lot.paid_in_full":
      return {
        state: patchLot(state, event.lotId, { status: "paid_in_full" }),
        commands: [setStatus(event.lotId, "paid_in_full")],
      }
    case "noshow.reported":
      return {
        state: patchLot(state, event.lotId, { status: "no_show_reported", deadlineBlock: event.contestEnds }),
        commands: [
          setStatus(event.lotId, "no_show_reported", event.contestEnds),
          { kind: "toast", text: `Buyer reported a no-show on Lot ${event.lotId}`, tone: "warn" },
        ],
      }
    case "noshow.contested":
      return {
        state: patchLot(state, event.lotId, { status: "disputed" }),
        commands: [
          setStatus(event.lotId, "disputed"),
          { kind: "toast", text: `Seller contested the no-show on Lot ${event.lotId}`, tone: "info" },
        ],
      }
    case "noshow.refunded": {
      const amount = lot ? money(event.refund, lot.currency) : undefined
      const text = amount
        ? `${amount} returned to the buyer on Lot ${event.lotId}`
        : `Lot ${event.lotId} refunded to the buyer`
      return {
        state: patchLot(state, event.lotId, { status: "refunded" }),
        commands: [
          { kind: "refundCoins", lotId: event.lotId, buyer: event.buyer, amountLabel: amount ?? "" },
          setStatus(event.lotId, "refunded"),
          { kind: "toast", text, tone: "warn" },
        ],
      }
    }
    case "seller.record": {
      const record: SellerState = { cleanLots: event.cleanLots, noShows: event.noShows, proven: event.proven }
      return {
        state: { ...state, sellers: { ...state.sellers, [event.seller]: record } },
        commands: [
          {
            kind: "markSeller",
            seller: event.seller,
            tier: event.proven ? "proven" : "new",
            cleanLots: event.cleanLots,
            noShows: event.noShows,
          },
        ],
      }
    }
    case "dispute.opened":
      return {
        state: patchLot(state, event.lotId, { status: "disputed" }),
        commands: [
          setStatus(event.lotId, "disputed"),
          { kind: "toast", text: `Dispute opened on Lot ${event.lotId}`, tone: "warn" },
        ],
      }
    case "dispute.resolved": {
      if (event.refundBps <= 0)
        return {
          state,
          commands: [{ kind: "toast", text: `Dispute on Lot ${event.lotId} resolved: no refund`, tone: "info" }],
        }
      return {
        state: patchLot(state, event.lotId, { status: "refunded" }),
        commands: [
          {
            kind: "toast",
            text: `Dispute on Lot ${event.lotId} resolved: ${formatBps(event.refundBps)} refund`,
            tone: "info",
          },
          setStatus(event.lotId, "refunded"),
        ],
      }
    }
    case "signal":
      return { state: { ...state, signals: { ...state.signals, [event.id]: event } }, commands: signalCommands(event) }
    case "reference.updated": {
      const ref: ReferenceState = { perUnit: event.perUnit, currency: event.currency, source: event.source }
      const price = money(event.perUnit, event.currency)
      const text = price
        ? `Reference price for ${event.commodity}: ${price}`
        : `Reference price for ${event.commodity} updated`
      return {
        state: { ...state, references: { ...state.references, [`${event.commodity}@${event.market}`]: ref } },
        commands: [{ kind: "toast", text, tone: "info" }],
      }
    }
    case "fx.updated":
      return { state: { ...state, fx: { ...state.fx, [event.currency]: event.perUsd } }, commands: [] }
    case "human.joined": {
      const human: AgentState = {
        agentId: event.agentId,
        name: event.name,
        role: "HUMAN",
        building: "town_gate",
        sprite: "human",
        human: true,
      }
      return { state: { ...state, agents: { ...state.agents, [event.agentId]: human } }, commands: [spawnAgent(human)] }
    }
    case "clock": {
      if (!event.phase) return { state: { ...state, block: event.block }, commands: [] }
      return { state: { ...state, block: event.block, phase: event.phase }, commands: phaseCommands(event.phase) }
    }
    default: {
      const unreachable: never = event
      return unreachable
    }
  }
}

const isActive = (l: LotState) => !FREES_SLOT.has(l.status)

/** Everything a scene needs to draw the current state from scratch, e.g. when it mounts late. */
export function commandsForState(state: TownState): TownCommand[] {
  const commands: TownCommand[] = state.phase ? phaseCommands(state.phase) : []
  for (const lot of Object.values(state.lots).filter(isActive)) {
    commands.push(placeStall(lot), setStatus(lot.lotId, lot.status, lot.deadlineBlock))
    if (lot.bids > 0 || lot.clearingPerUnit) commands.push(tickPrice(lot))
  }
  for (const agent of Object.values(state.agents)) commands.push(spawnAgent(agent))
  for (const signal of Object.values(state.signals)) commands.push(...signalCommands(signal))
  return commands
}

/** State from a relay snapshot (contract 12.3), plus the commands to draw it. */
export function hydrate(snapshot: TownSnapshot): ReduceResult {
  const lots: Record<string, LotState> = {}
  for (const l of snapshot.lots) {
    const draft: LotState = { ...l, slot: null }
    lots[l.lotId] = { ...draft, slot: isActive(draft) ? freeSlot(lots, l.building) : null }
  }
  const agents: Record<string, AgentState> = {}
  for (const a of snapshot.agents) agents[a.agentId] = { ...a, human: a.role === "HUMAN" }
  const signals: Record<string, SignalEvent> = {}
  for (const s of snapshot.signals) signals[s.id] = s
  const state: TownState = { ...initialTownState, block: snapshot.block, lots, agents, signals, fx: { ...snapshot.fx } }
  return { state, commands: commandsForState(state) }
}
