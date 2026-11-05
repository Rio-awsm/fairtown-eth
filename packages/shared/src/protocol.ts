import { z } from "zod"
import { BUILDINGS, LOT_STATUS, ROLE_NAMES, SECTORS, SIGNAL_KINDS } from "./keys"
import { Dec } from "./units"

const zBuilding = z.enum(BUILDINGS)
const zSector = z.enum(SECTORS)
const zRole = z.enum(ROLE_NAMES)
const zSignalKind = z.enum(SIGNAL_KINDS)
const int = () => z.number().int()
const INTENT_ACTIONS = ["bid", "pass", "list", "relist", "move", "handover", "report_no_show"] as const

export const LotListedEvent = z.object({
  type: z.literal("lot.listed"),
  lotId: Dec,
  building: zBuilding,
  sector: zSector,
  commodity: z.string(),
  qty: z.number(),
  unit: z.string(),
  currency: z.string(),
  place: z.string(),
  floorPerUnit: Dec,
  seller: z.string(),
  sellerName: z.string(),
  auction: z.string(),
  endBlock: int(),
  parentLotId: Dec,
  grade: z.string(),
})

export const SignalEvent = z.object({
  type: z.literal("signal"),
  id: z.string(),
  kind: zSignalKind,
  place: z.string(),
  severity: int(),
  label: z.string(),
  expiresAtBlock: int(),
})

const AgentFields = {
  agentId: z.string(),
  name: z.string(),
  role: zRole,
  building: zBuilding,
  sprite: z.string(),
  ensName: z.string().optional(),
}

export const TownEvent = z.discriminatedUnion("type", [
  LotListedEvent,
  z.object({ type: z.literal("agent.spawned"), ...AgentFields }),
  z.object({
    type: z.literal("agent.intent"),
    agentId: z.string(),
    action: z.enum(INTENT_ACTIONS),
    moveTo: zBuilding.optional(),
    lotId: Dec.optional(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("bid.placed"),
    lotId: Dec,
    agentId: z.string(),
    maxPerUnit: Dec,
    amount: Dec,
    tx: z.string(),
  }),
  z.object({ type: z.literal("price.tick"), lotId: Dec, clearingPerUnit: Dec }),
  z.object({
    type: z.literal("lot.settled"),
    lotId: Dec,
    finalClearingPerUnit: Dec,
    avgPerUnit: Dec,
    soldUnits: Dec,
    sellerPaid: Dec,
    held: Dec,
    fee: Dec,
    advanceBps: int(),
    pickupDeadline: int(),
    tx: z.string(),
  }),
  z.object({ type: z.literal("lot.relisted"), lotId: Dec, newLotId: Dec, newFloorPerUnit: Dec }),
  z.object({ type: z.literal("transport.needed"), lotId: Dec, fromBuilding: zBuilding, place: z.string(), qty: Dec }),
  z.object({ type: z.literal("storage.needed"), lotId: Dec, requester: z.string(), qty: Dec, days: int() }),
  z.object({ type: z.literal("carrier.assigned"), lotId: Dec, truckLotId: Dec, carrier: z.string() }),
  z.object({
    type: z.literal("handover.confirmed"),
    lotId: Dec,
    buyer: z.string(),
    receiver: z.string(),
    releasedToSeller: Dec,
    tx: z.string(),
  }),
  z.object({ type: z.literal("lot.paid_in_full"), lotId: Dec }),
  z.object({ type: z.literal("lot.delivered"), lotId: Dec, truckLotId: Dec }),
  z.object({ type: z.literal("noshow.reported"), lotId: Dec, buyer: z.string(), contestEnds: int() }),
  z.object({ type: z.literal("noshow.contested"), lotId: Dec, buyer: z.string(), disputeId: Dec }),
  z.object({ type: z.literal("noshow.refunded"), lotId: Dec, seller: z.string(), buyer: z.string(), refund: Dec }),
  z.object({
    type: z.literal("seller.record"),
    seller: z.string(),
    cleanLots: int(),
    noShows: int(),
    proven: z.boolean(),
  }),
  z.object({
    type: z.literal("dispute.opened"),
    disputeId: Dec,
    lotId: Dec,
    buyer: z.string(),
    kind: z.enum(["quality", "no_show"]),
  }),
  z.object({ type: z.literal("dispute.resolved"), disputeId: Dec, lotId: Dec, refundBps: int() }),
  SignalEvent,
  z.object({
    type: z.literal("reference.updated"),
    commodity: z.string(),
    market: z.string(),
    perUnit: Dec,
    currency: z.string(),
    source: z.string(),
  }),
  z.object({ type: z.literal("fx.updated"), currency: z.string(), perUsd: z.number() }),
  z.object({ type: z.literal("human.joined"), agentId: z.string(), name: z.string() }),
  z.object({
    type: z.literal("clock"),
    block: int(),
    phase: z.enum(["dawn", "morning", "noon", "evening", "night"]).optional(),
  }),
])
export type TownEvent = z.infer<typeof TownEvent>
export type LotListedEvent = z.infer<typeof LotListedEvent>
export type SignalEvent = z.infer<typeof SignalEvent>

export const TOWN_EVENT_TYPES = TownEvent.options.map((o) => o.shape.type.value)

export const TownEnvelope = z.object({
  v: z.literal(1),
  id: z.string(),
  ts: z.number(),
  block: int().optional(),
  source: z.enum(["chain", "arkiv", "agents", "director"]),
  event: TownEvent,
})
export type TownEnvelope = z.infer<typeof TownEnvelope>

export const TownSnapshot = z.object({
  block: int(),
  lots: z.array(
    LotListedEvent.extend({
      status: z.enum(LOT_STATUS),
      clearingPerUnit: Dec.optional(),
      avgPerUnit: Dec.optional(),
      bids: int(),
      pickupDeadline: int().optional(),
    }),
  ),
  agents: z.array(z.object(AgentFields)),
  signals: z.array(SignalEvent),
  fx: z.record(z.string(), z.number()),
  recent: z.array(TownEnvelope).max(200),
})
export type TownSnapshot = z.infer<typeof TownSnapshot>
