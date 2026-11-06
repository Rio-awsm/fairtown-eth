import { BUILDINGS, CURRENCIES, type Building, type Currency, type LotStatus, type Role } from "@fairtown/shared/keys"
import type { LotListedEvent, SignalEvent, TownEnvelope, TownEvent, TownSnapshot } from "@fairtown/shared/protocol"
import { formatBps, formatMoney, formatPerUnit, unitLabel } from "../money/format"
import { BUBBLE_MAX, type Phase, type TownCommand } from "./commands"

export type LotState = LotListedEvent & {
  status: LotStatus
  slot: number | null
  bids: number
  clearingPerUnit?: string
  avgPerUnit?: string
  pickupDeadline?: number
  deadlineBlock?: number
  /** History for the lot panel (S3 1.4). */
  bidLog: BidEntry[]
  priceLog: { block: number; perUnit: string }[]
  settlement?: { sellerPaid: string; held: string; fee: string; advanceBps: number; soldUnits: string; tx: string }
  handoverTx?: string
  /** Truck assigned to carry the lot (carrier.assigned): it may receive the seller's handover code. */
  carrier?: string
  /** Buyer who reported a no-show, so the seller can contest it. */
  noShowBuyer?: string
  relistedAs?: string
  /** Furthest of the five steps reached (0 to 5), kept through refunds. */
  progress: number
  refundReason?: "no_show" | "dispute"
  refundBps?: number
}
export type BidEntry = { agentId: string; maxPerUnit: string; amount: string; tx: string }
export type AgentState = {
  agentId: string
  name: string
  role: Role
  building: Building
  sprite: string
  ensName?: string
  human: boolean
  /** Last few reasons from agent.intent, newest last, for the agent panel. */
  reasons: string[]
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
const REASONS_KEPT = 5
/** The five timeline steps as lot statuses, in order (S3 1.4). */
export const STEP_STATUSES: readonly LotStatus[] = ["sold", "truck_booked", "picked_up", "delivered", "paid_in_full"]
const progressOf = (status: LotStatus) => STEP_STATUSES.indexOf(status) + 1
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
const asBuilding = (b: string): Building | undefined =>
  (BUILDINGS as readonly string[]).find((x) => x === b) as Building | undefined
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
  if (patch.status) next.progress = Math.max(lot.progress, progressOf(patch.status))
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
    seller: lot.seller,
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
        bidLog: [],
        priceLog: [],
        progress: 0,
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
        reasons: state.agents[event.agentId]?.reasons ?? [],
        ...(event.ensName ? { ensName: event.ensName } : {}),
      }
      return { state: { ...state, agents: { ...state.agents, [event.agentId]: agent } }, commands: [spawnAgent(agent)] }
    }
    case "agent.intent": {
      const target = event.moveTo ?? (event.lotId ? state.lots[event.lotId]?.building : undefined)
      const commands: TownCommand[] = target ? [{ kind: "walkTo", agentId: event.agentId, building: target }] : []
      commands.push({ kind: "showBubble", agentId: event.agentId, text: bubble(event.reason) })
      const agent = state.agents[event.agentId]
      if (!agent) return { state, commands }
      const reasons = [...agent.reasons, event.reason].slice(-REASONS_KEPT)
      return { state: { ...state, agents: { ...state.agents, [event.agentId]: { ...agent, reasons } } }, commands }
    }
    case "bid.placed": {
      if (!lot) return { state, commands: [] }
      const entry: BidEntry = {
        agentId: event.agentId,
        maxPerUnit: event.maxPerUnit,
        amount: event.amount,
        tx: event.tx,
      }
      const next = patchLot(state, event.lotId, { bids: lot.bids + 1, bidLog: [...lot.bidLog, entry] })
      return {
        state: next,
        commands: [{ kind: "coinArc", lotId: event.lotId, agentId: event.agentId }, tickPrice(next.lots[event.lotId]!)],
      }
    }
    case "price.tick": {
      if (!lot) return { state, commands: [] }
      const next = patchLot(state, event.lotId, {
        clearingPerUnit: event.clearingPerUnit,
        priceLog: [...lot.priceLog, { block: state.block, perUnit: event.clearingPerUnit }],
      })
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
          settlement: {
            sellerPaid: event.sellerPaid,
            held: event.held,
            fee: event.fee,
            advanceBps: event.advanceBps,
            soldUnits: event.soldUnits,
            tx: event.tx,
          },
        }),
        commands: [{ kind: "flashClear", lotId: event.lotId }, { kind: "toast", text, tone: "money" }, status],
      }
    }
    case "lot.relisted": {
      const label = lot ? perUnit(event.newFloorPerUnit, lot.currency, lot.unit) : undefined
      return {
        state: patchLot(state, event.lotId, { status: "relisted", relistedAs: event.newLotId }),
        commands: [
          label
            ? { kind: "fadeStall", lotId: event.lotId, newFloorLabel: label }
            : { kind: "fadeStall", lotId: event.lotId },
          setStatus(event.lotId, "relisted"),
        ],
      }
    }
    case "transport.needed": {
      const unit = lot ? ` ${unitLabel(lot.unit)}` : ""
      return {
        state,
        commands: [
          { kind: "toast", text: `Truck needed: ${event.qty}${unit} from ${titleCase(event.place)}`, tone: "info" },
        ],
      }
    }
    case "storage.needed": {
      const unit = lot ? ` ${unitLabel(lot.unit)}` : ""
      const days = event.days === 1 ? "1 day" : `${event.days} days`
      const commands: TownCommand[] = [{ kind: "openVault", lotId: event.lotId }]
      if (state.agents[event.requester])
        commands.push({ kind: "walkTo", agentId: event.requester, building: "cold_vault" })
      commands.push({ kind: "toast", text: `Cold storage needed: ${event.qty}${unit} for ${days}`, tone: "info" })
      return { state, commands }
    }
    case "carrier.assigned": {
      const commands: TownCommand[] = lot
        ? [{ kind: "driveTruck", lotId: event.lotId, from: "freight_yard", to: lot.building }]
        : []
      commands.push(setStatus(event.lotId, "truck_booked"))
      return { state: patchLot(state, event.lotId, { status: "truck_booked", carrier: event.carrier }), commands }
    }
    case "handover.confirmed": {
      const rest = lot && money(event.releasedToSeller, lot.currency)
      const status = setStatus(event.lotId, "picked_up")
      const text = rest ? `${rest} rest received` : `Lot ${event.lotId} picked up`
      if (!lot) return { state, commands: [{ kind: "toast", text, tone: "money" }, status] }
      const to = event.receiver.toLowerCase() === event.buyer.toLowerCase() ? "buyer" : "truck"
      return {
        state: patchLot(state, event.lotId, { status: "picked_up", handoverTx: event.tx }),
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
        state: patchLot(state, event.lotId, {
          status: "no_show_reported",
          deadlineBlock: event.contestEnds,
          noShowBuyer: event.buyer,
        }),
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
        state: patchLot(state, event.lotId, { status: "refunded", refundReason: "no_show" }),
        commands: [
          { kind: "refundCoins", lotId: event.lotId, buyer: event.buyer, amountLabel: amount ?? "" },
          setStatus(event.lotId, "refunded"),
          { kind: "signNoShow", lotId: event.lotId, seller: event.seller },
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
          { kind: "inspect", lotId: event.lotId },
          setStatus(event.lotId, "disputed"),
          { kind: "toast", text: `Dispute opened on Lot ${event.lotId}`, tone: "warn" },
        ],
      }
    case "dispute.resolved": {
      const label = event.refundBps > 0 ? `${formatBps(event.refundBps)} refund` : "No refund"
      const toast: TownCommand = {
        kind: "toast",
        text: `Dispute on Lot ${event.lotId} resolved: ${event.refundBps > 0 ? label : "no refund"}`,
        tone: "info",
      }
      const badge: TownCommand = { kind: "refundBadge", lotId: event.lotId, label }
      if (event.refundBps <= 0) return { state, commands: [toast, badge] }
      return {
        state: patchLot(state, event.lotId, {
          status: "refunded",
          refundReason: "dispute",
          refundBps: event.refundBps,
        }),
        commands: [toast, badge, setStatus(event.lotId, "refunded")],
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
      const plaque = plaqueFor(event.market, event.perUnit, event.currency)
      const commands: TownCommand[] = plaque ? [plaque] : []
      commands.push({ kind: "toast", text, tone: "info" })
      return {
        state: { ...state, references: { ...state.references, [`${event.commodity}@${event.market}`]: ref } },
        commands,
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
        reasons: [],
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

/** The reference plaque at a market building, when the market is a building and the price can be shown. */
function plaqueFor(market: string, perUnit: string, currency: string): TownCommand | undefined {
  const building = asBuilding(market)
  const price = money(perUnit, currency)
  return building && price ? { kind: "plaque", building, text: `Reference ${price}` } : undefined
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
  // Plaques persist, so a scene that mounts late (slow map load) must still get them.
  for (const [key, ref] of Object.entries(state.references)) {
    const plaque = plaqueFor(key.split("@")[1] ?? "", ref.perUnit, ref.currency)
    if (plaque) commands.push(plaque)
  }
  for (const [seller, r] of Object.entries(state.sellers))
    commands.push({
      kind: "markSeller",
      seller,
      tier: r.proven ? "proven" : "new",
      cleanLots: r.cleanLots,
      noShows: r.noShows,
    })
  return commands
}

/** Reduces one relay envelope: advances the town clock from its block (never backwards), then the event. */
export function reduceEnvelope(state: TownState, envelope: TownEnvelope): ReduceResult {
  const eventBlock = envelope.event.type === "clock" ? envelope.event.block : 0
  const block = Math.max(state.block, envelope.block ?? 0, eventBlock)
  const reduced = reduce({ ...state, block: Math.max(state.block, envelope.block ?? 0) }, envelope.event)
  const next = { ...reduced.state, block: Math.max(reduced.state.block, block) }
  if (block <= state.block) return { state: next, commands: reduced.commands }
  return { state: next, commands: [{ kind: "setClock", block }, ...reduced.commands] }
}

/** State from a relay snapshot (contract 12.3), plus the commands to draw it. */
export function hydrate(snapshot: TownSnapshot): ReduceResult {
  const lots: Record<string, LotState> = {}
  for (const l of snapshot.lots) {
    const priceLog = l.clearingPerUnit ? [{ block: snapshot.block, perUnit: l.clearingPerUnit }] : []
    const draft: LotState = { ...l, slot: null, bidLog: [], priceLog, progress: progressOf(l.status) }
    lots[l.lotId] = { ...draft, slot: isActive(draft) ? freeSlot(lots, l.building) : null }
  }
  const agents: Record<string, AgentState> = {}
  for (const a of snapshot.agents) agents[a.agentId] = { ...a, human: a.role === "HUMAN", reasons: [] }
  const signals: Record<string, SignalEvent> = {}
  for (const s of snapshot.signals) signals[s.id] = s
  const state: TownState = { ...initialTownState, block: snapshot.block, lots, agents, signals, fx: { ...snapshot.fx } }
  return { state, commands: commandsForState(state) }
}
