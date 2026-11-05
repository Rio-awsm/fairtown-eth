import type { TownEnvelope, TownEvent, TownSnapshot } from "@fairtown/shared/protocol"

export const SELLER = "0x00000000000000000000000000000000000000a1"
export const BUYER = "0x00000000000000000000000000000000000000b2"
export const TRUCK = "0x00000000000000000000000000000000000000c3"
export const AUCTION = "0x00000000000000000000000000000000000000d4"
export const TX = `0x${"ab".repeat(32)}`

type Samples = { [K in TownEvent["type"]]: Extract<TownEvent, { type: K }> }

/** One event of every type, Bergen cod values from source of truth 5. A missing type fails to compile. */
export const SAMPLE_EVENTS: Samples = {
  "lot.listed": {
    type: "lot.listed",
    lotId: "12",
    building: "fish_dock",
    sector: "fish",
    commodity: "cod",
    qty: 600,
    unit: "kg",
    currency: "EUR",
    place: "bergen",
    floorPerUnit: "7500000",
    seller: SELLER,
    sellerName: "Ingrid Solheim",
    auction: AUCTION,
    endBlock: 1045,
    parentLotId: "0",
    grade: "fresh_a",
  },
  "agent.spawned": {
    type: "agent.spawned",
    agentId: BUYER,
    name: "Hanse Kitchen",
    role: "BUYER",
    building: "fish_dock",
    sprite: "chef",
  },
  "agent.intent": {
    type: "agent.intent",
    agentId: BUYER,
    action: "bid",
    lotId: "12",
    reason: "Grade A cod, storm tomorrow, capping at €9.40/kg",
  },
  "bid.placed": {
    type: "bid.placed",
    lotId: "12",
    agentId: BUYER,
    maxPerUnit: "9400000",
    amount: "5460000000",
    tx: TX,
  },
  "price.tick": { type: "price.tick", lotId: "12", clearingPerUnit: "8100000" },
  "lot.settled": {
    type: "lot.settled",
    lotId: "12",
    finalClearingPerUnit: "9000000",
    avgPerUnit: "9100000",
    soldUnits: "600",
    sellerPaid: "2702700000",
    held: "2702700000",
    fee: "54600000",
    advanceBps: 5000,
    pickupDeadline: 1200,
    tx: TX,
  },
  "lot.relisted": { type: "lot.relisted", lotId: "12", newLotId: "13", newFloorPerUnit: "6375000" },
  "transport.needed": { type: "transport.needed", lotId: "12", fromBuilding: "fish_dock", place: "bergen", qty: "600" },
  "storage.needed": { type: "storage.needed", lotId: "12", requester: BUYER, qty: "3000", days: 2 },
  "carrier.assigned": { type: "carrier.assigned", lotId: "12", truckLotId: "20", carrier: TRUCK },
  "handover.confirmed": {
    type: "handover.confirmed",
    lotId: "12",
    buyer: BUYER,
    receiver: TRUCK,
    releasedToSeller: "2702700000",
    tx: TX,
  },
  "lot.paid_in_full": { type: "lot.paid_in_full", lotId: "12" },
  "lot.delivered": { type: "lot.delivered", lotId: "12", truckLotId: "20" },
  "noshow.reported": { type: "noshow.reported", lotId: "12", buyer: BUYER, contestEnds: 1500 },
  "noshow.contested": { type: "noshow.contested", lotId: "12", buyer: BUYER, disputeId: "3" },
  "noshow.refunded": { type: "noshow.refunded", lotId: "12", seller: SELLER, buyer: BUYER, refund: "2702700000" },
  "seller.record": { type: "seller.record", seller: SELLER, cleanLots: 3, noShows: 0, proven: true },
  "dispute.opened": { type: "dispute.opened", disputeId: "3", lotId: "12", buyer: BUYER, kind: "quality" },
  "dispute.resolved": { type: "dispute.resolved", disputeId: "3", lotId: "12", refundBps: 2500 },
  signal: {
    type: "signal",
    id: "sig-1",
    kind: "weather",
    place: "bergen",
    severity: 3,
    label: "Storm forecast",
    expiresAtBlock: 2000,
  },
  "reference.updated": {
    type: "reference.updated",
    commodity: "cod",
    market: "fish_dock",
    perUnit: "8300000",
    currency: "EUR",
    source: "Fiskeridirektoratet",
  },
  "fx.updated": { type: "fx.updated", currency: "INR", perUsd: 84 },
  "human.joined": { type: "human.joined", agentId: "0x00000000000000000000000000000000000000e5", name: "Priya" },
  clock: { type: "clock", block: 1100, phase: "night" },
}

let seq = 0
export const envelope = (event: TownEvent, id = `t-${++seq}`): TownEnvelope => ({
  v: 1,
  id,
  ts: 1_790_000_000_000 + seq,
  source: "chain",
  event,
})

export const emptySnapshot = (): TownSnapshot => ({ block: 0, lots: [], agents: [], signals: [], fx: {}, recent: [] })
