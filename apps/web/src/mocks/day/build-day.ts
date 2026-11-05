import type { LotListedEvent, TownEnvelope, TownEvent } from "@fairtown/shared/protocol"

/**
 * Temporary stand-in for packages/shared/fixtures/day.jsonl (S2 0.1). Scenes follow source of
 * truth section 5. Amounts follow contract 5 (6-decimal base units) and the payout rules
 * (1% fee, new sellers 50% advance, trucks 10%). One envelope id repeats on purpose so the
 * replay exercises dedupe.
 */
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`

const A = {
  ingrid: addr(0x101),
  hanse: addr(0x102),
  fjord: addr(0x103),
  lars: addr(0x104),
  maya: addr(0x105),
  gulf: addr(0x106),
  northlight: addr(0x107),
  atlas: addr(0x108),
  ganesh: addr(0x109),
  dadar: addr(0x10a),
  amina: addr(0x10b),
  mile12: addr(0x10c),
  coastal: addr(0x10d),
  shanti: addr(0x10e),
  priya: addr(0x10f),
} as const
const AUCTION = (lotId: number) => addr(0xa000 + lotId)

const START_TS = Date.UTC(2026, 10, 6, 4, 0)
const START_BLOCK = 1000

type Source = TownEnvelope["source"]

export function buildDay(): TownEnvelope[] {
  const out: TownEnvelope[] = []
  let block = START_BLOCK
  let txSeq = 1
  const push = (source: Source, event: TownEvent) => {
    block += 2
    const n = out.length + 1
    out.push({
      v: 1,
      id: `d-${String(n).padStart(4, "0")}`,
      ts: START_TS + n * 1000,
      ...(source === "chain" ? { block } : {}),
      source,
      event,
    })
  }
  const chain = (event: TownEvent) => push("chain", event)
  const agents = (event: TownEvent) => push("agents", event)
  const nextTx = () => tx(txSeq++)
  const listed = (
    e: Omit<LotListedEvent, "type" | "auction" | "endBlock" | "parentLotId"> & { parentLotId?: string },
  ) =>
    chain({
      type: "lot.listed",
      auction: AUCTION(Number(e.lotId)),
      endBlock: block + 40,
      parentLotId: "0",
      ...e,
    })
  const spawn = (
    agentId: string,
    name: string,
    role: Extract<TownEvent, { type: "agent.spawned" }>["role"],
    building: Extract<TownEvent, { type: "agent.spawned" }>["building"],
    sprite: string,
    ensName?: string,
  ) => agents({ type: "agent.spawned", agentId, name, role, building, sprite, ...(ensName ? { ensName } : {}) })

  // Morning: the cast arrives.
  agents({ type: "clock", block, phase: "dawn" })
  spawn(A.ingrid, "Ingrid Solheim", "SELLER", "fish_dock", "fisher")
  spawn(A.hanse, "Hanse Kitchen", "BUYER", "fish_dock", "chef")
  spawn(A.fjord, "Fjord Processing", "BUYER", "fish_dock", "worker")
  spawn(A.lars, "Lars", "TRUCK", "freight_yard", "truck")
  spawn(A.maya, "Maya Torres", "TRUCK", "freight_yard", "truck")
  spawn(A.gulf, "Gulf Produce", "BUYER", "freight_yard", "worker")
  spawn(A.northlight, "Northlight Compute", "SELLER", "compute_yard", "rack")
  spawn(A.atlas, "Atlas Labs", "BUYER", "compute_yard", "bot", "atlas.fairtown.eth")
  spawn(A.ganesh, "Ganesh Pawar", "SELLER", "flower_hall", "farmer")
  spawn(A.dadar, "Dadar Flower Traders", "BUYER", "flower_hall", "trader")
  spawn(A.amina, "Amina Bello", "SELLER", "harvest_hall", "farmer")
  spawn(A.mile12, "Mile 12 Cooperative", "BUYER", "harvest_hall", "trader")
  spawn(A.coastal, "Coastal Catch", "SELLER", "fish_dock", "fisher")
  spawn(A.shanti, "Shanti Niwas", "SOCIETY", "neighbourhood_pool", "family")
  chain({ type: "fx.updated", currency: "EUR", perUsd: 0.92 })
  chain({ type: "fx.updated", currency: "NOK", perUsd: 10.83 })
  chain({ type: "fx.updated", currency: "INR", perUsd: 84 })

  // Scene 1: the Bergen cod clock.
  chain({
    type: "reference.updated",
    commodity: "cod",
    market: "fish_dock",
    perUnit: "8300000",
    currency: "EUR",
    source: "fixture",
  })
  chain({
    type: "signal",
    id: "sig-storm-bergen",
    kind: "weather",
    place: "bergen",
    severity: 3,
    label: "Storm forecast for Bergen tomorrow",
    expiresAtBlock: block + 400,
  })
  listed({
    lotId: "12",
    building: "fish_dock",
    sector: "fish",
    commodity: "cod",
    qty: 600,
    unit: "kg",
    currency: "EUR",
    place: "bergen",
    floorPerUnit: "7500000",
    seller: A.ingrid,
    sellerName: "Ingrid Solheim",
    grade: "fresh_a",
  })
  agents({
    type: "agent.intent",
    agentId: A.hanse,
    action: "bid",
    lotId: "12",
    reason: "Grade A cod and a storm tomorrow, capping at €9.40/kg",
  })
  agents({
    type: "agent.intent",
    agentId: A.fjord,
    action: "bid",
    lotId: "12",
    reason: "Need 600 kg for the processing line, up to €9.20/kg",
  })
  chain({
    type: "bid.placed",
    lotId: "12",
    agentId: A.hanse,
    maxPerUnit: "9400000",
    amount: "3000000000",
    tx: nextTx(),
  })
  chain({ type: "price.tick", lotId: "12", clearingPerUnit: "8100000" })
  chain({
    type: "bid.placed",
    lotId: "12",
    agentId: A.fjord,
    maxPerUnit: "9200000",
    amount: "2460000000",
    tx: nextTx(),
  })
  chain({ type: "price.tick", lotId: "12", clearingPerUnit: "8700000" })
  agents({ type: "clock", block, phase: "morning" })
  // €5,460 raised: fee €54.60, Ingrid is new so €2,702.70 now and €2,702.70 held.
  chain({
    type: "lot.settled",
    lotId: "12",
    finalClearingPerUnit: "9000000",
    avgPerUnit: "9100000",
    soldUnits: "600",
    sellerPaid: "2702700000",
    held: "2702700000",
    fee: "54600000",
    advanceBps: 5000,
    pickupDeadline: block + 150,
    tx: nextTx(),
  })
  chain({ type: "transport.needed", lotId: "12", fromBuilding: "fish_dock", place: "bergen", qty: "600" })
  agents({
    type: "agent.intent",
    agentId: A.lars,
    action: "list",
    lotId: "20",
    reason: "Reefer running empty to Oslo, listing the space",
  })
  listed({
    lotId: "20",
    building: "freight_yard",
    sector: "truck",
    commodity: "truck_capacity",
    qty: 600,
    unit: "kg_route",
    currency: "EUR",
    place: "bergen",
    floorPerUnit: "500000",
    seller: A.lars,
    sellerName: "Lars",
    grade: "na",
    parentLotId: "12",
  })
  chain({ type: "bid.placed", lotId: "20", agentId: A.hanse, maxPerUnit: "650000", amount: "390000000", tx: nextTx() })
  // €360 raised: fee €3.60, trucks get 10% of net now (€35.64), €320.76 held.
  chain({
    type: "lot.settled",
    lotId: "20",
    finalClearingPerUnit: "600000",
    avgPerUnit: "600000",
    soldUnits: "600",
    sellerPaid: "35640000",
    held: "320760000",
    fee: "3600000",
    advanceBps: 1000,
    pickupDeadline: block + 150,
    tx: nextTx(),
  })
  chain({ type: "carrier.assigned", lotId: "12", truckLotId: "20", carrier: A.lars })
  agents({
    type: "agent.intent",
    agentId: A.lars,
    action: "handover",
    moveTo: "fish_dock",
    lotId: "12",
    reason: "At the dock, scanning Ingrid's handover code",
  })
  chain({
    type: "handover.confirmed",
    lotId: "12",
    buyer: A.hanse,
    receiver: A.lars,
    releasedToSeller: "2702700000",
    tx: nextTx(),
  })
  chain({ type: "lot.delivered", lotId: "12", truckLotId: "20" })
  chain({
    type: "handover.confirmed",
    lotId: "20",
    buyer: A.hanse,
    receiver: A.hanse,
    releasedToSeller: "320760000",
    tx: nextTx(),
  })
  chain({ type: "lot.paid_in_full", lotId: "12" })
  chain({ type: "lot.paid_in_full", lotId: "20" })
  chain({ type: "seller.record", seller: A.ingrid, cleanLots: 1, noShows: 0, proven: false })

  // Scene 4: the Diwali marigold rush, with a walk-in judge.
  agents({ type: "clock", block, phase: "noon" })
  chain({
    type: "signal",
    id: "sig-diwali-mumbai",
    kind: "festival",
    place: "mumbai",
    severity: 2,
    label: "Diwali in 3 days",
    expiresAtBlock: block + 2000,
  })
  listed({
    lotId: "30",
    building: "flower_hall",
    sector: "flowers",
    commodity: "marigold",
    qty: 2000,
    unit: "kg",
    currency: "USD",
    place: "pune",
    floorPerUnit: "1200000",
    seller: A.ganesh,
    sellerName: "Ganesh Pawar",
    grade: "bloom_a",
  })
  agents({
    type: "agent.intent",
    agentId: A.dadar,
    action: "bid",
    lotId: "30",
    reason: "Diwali demand, garlands need 2 tonnes by Saturday",
  })
  agents({ type: "human.joined", agentId: A.priya, name: "Priya" })
  chain({
    type: "bid.placed",
    lotId: "30",
    agentId: A.dadar,
    maxPerUnit: "1450000",
    amount: "2900000000",
    tx: nextTx(),
  })
  chain({ type: "bid.placed", lotId: "30", agentId: A.priya, maxPerUnit: "1600000", amount: "200000000", tx: nextTx() })
  out.push({ ...out[out.length - 1]!, ts: START_TS + (out.length + 1) * 1000 }) // relay resend: same id
  chain({ type: "price.tick", lotId: "30", clearingPerUnit: "1500000" })
  // $3,100 raised: fee $31, $1,534.50 now and $1,534.50 held.
  chain({
    type: "lot.settled",
    lotId: "30",
    finalClearingPerUnit: "1500000",
    avgPerUnit: "1550000",
    soldUnits: "2000",
    sellerPaid: "1534500000",
    held: "1534500000",
    fee: "31000000",
    advanceBps: 5000,
    pickupDeadline: block + 225,
    tx: nextTx(),
  })

  // Scene 3: the GPU going dark (simulated provider, labelled).
  listed({
    lotId: "40",
    building: "compute_yard",
    sector: "compute",
    commodity: "gpu_hour",
    qty: 200,
    unit: "gpu_hour",
    currency: "USD",
    place: "any_dc",
    floorPerUnit: "2000000",
    seller: A.northlight,
    sellerName: "Northlight Compute",
    grade: "gpu_verified",
  })
  agents({
    type: "agent.intent",
    agentId: A.atlas,
    action: "pass",
    lotId: "40",
    reason: "Floor is above my compute budget, waiting",
  })
  chain({ type: "lot.relisted", lotId: "40", newLotId: "41", newFloorPerUnit: "1700000" })
  listed({
    lotId: "41",
    building: "compute_yard",
    sector: "compute",
    commodity: "gpu_hour",
    qty: 200,
    unit: "gpu_hour",
    currency: "USD",
    place: "any_dc",
    floorPerUnit: "1700000",
    seller: A.northlight,
    sellerName: "Northlight Compute",
    grade: "gpu_verified",
  })
  agents({
    type: "agent.intent",
    agentId: A.atlas,
    action: "bid",
    lotId: "41",
    reason: "Training run starts at 02:00, buying 200 hours",
  })
  chain({ type: "bid.placed", lotId: "41", agentId: A.atlas, maxPerUnit: "1900000", amount: "380000000", tx: nextTx() })
  // $360 raised: fee $3.60, $178.20 now and $178.20 held.
  chain({
    type: "lot.settled",
    lotId: "41",
    finalClearingPerUnit: "1800000",
    avgPerUnit: "1800000",
    soldUnits: "200",
    sellerPaid: "178200000",
    held: "178200000",
    fee: "3600000",
    advanceBps: 5000,
    pickupDeadline: block + 30,
    tx: nextTx(),
  })
  agents({
    type: "agent.intent",
    agentId: A.atlas,
    action: "report_no_show",
    lotId: "41",
    reason: "Health check failed at start time",
  })
  chain({ type: "noshow.reported", lotId: "41", buyer: A.atlas, contestEnds: block + 60 })
  chain({ type: "noshow.contested", lotId: "41", buyer: A.atlas, disputeId: "8" })
  chain({ type: "dispute.opened", disputeId: "8", lotId: "41", buyer: A.atlas, kind: "no_show" })

  // Scene 6: Lagos tomatoes (seeded), cold storage and a quality dispute.
  listed({
    lotId: "50",
    building: "harvest_hall",
    sector: "produce",
    commodity: "tomato",
    qty: 3000,
    unit: "kg",
    currency: "USD",
    place: "lagos",
    floorPerUnit: "400000",
    seller: A.amina,
    sellerName: "Amina Bello",
    grade: "class_1",
  })
  chain({
    type: "bid.placed",
    lotId: "50",
    agentId: A.mile12,
    maxPerUnit: "480000",
    amount: "1440000000",
    tx: nextTx(),
  })
  // $1,350 raised: fee $13.50, $668.25 now and $668.25 held.
  chain({
    type: "lot.settled",
    lotId: "50",
    finalClearingPerUnit: "450000",
    avgPerUnit: "450000",
    soldUnits: "3000",
    sellerPaid: "668250000",
    held: "668250000",
    fee: "13500000",
    advanceBps: 5000,
    pickupDeadline: block + 225,
    tx: nextTx(),
  })
  chain({ type: "storage.needed", lotId: "50", requester: A.mile12, qty: "3000", days: 2 })
  chain({ type: "dispute.opened", disputeId: "7", lotId: "50", buyer: A.mile12, kind: "quality" })
  chain({ type: "dispute.resolved", disputeId: "7", lotId: "50", refundBps: 2500 })

  // Scene 7: the no-show, shown on purpose.
  agents({ type: "clock", block, phase: "evening" })
  listed({
    lotId: "60",
    building: "fish_dock",
    sector: "fish",
    commodity: "haddock",
    qty: 300,
    unit: "kg",
    currency: "EUR",
    place: "bergen",
    floorPerUnit: "5000000",
    seller: A.coastal,
    sellerName: "Coastal Catch",
    grade: "fresh_a",
  })
  chain({
    type: "bid.placed",
    lotId: "60",
    agentId: A.hanse,
    maxPerUnit: "5600000",
    amount: "1680000000",
    tx: nextTx(),
  })
  // €1,650 raised: fee €16.50, €816.75 now and €816.75 held.
  chain({
    type: "lot.settled",
    lotId: "60",
    finalClearingPerUnit: "5500000",
    avgPerUnit: "5500000",
    soldUnits: "300",
    sellerPaid: "816750000",
    held: "816750000",
    fee: "16500000",
    advanceBps: 5000,
    pickupDeadline: block + 150,
    tx: nextTx(),
  })
  // Time passes: Coastal Catch's pickup deadline (150 blocks) runs out before Hanse reports the no-show.
  block += 160
  agents({ type: "clock", block })
  agents({
    type: "agent.intent",
    agentId: A.hanse,
    action: "report_no_show",
    lotId: "60",
    reason: "Pickup deadline passed, Coastal Catch never showed",
  })
  chain({ type: "noshow.reported", lotId: "60", buyer: A.hanse, contestEnds: block + 60 })
  chain({ type: "noshow.refunded", lotId: "60", seller: A.coastal, buyer: A.hanse, refund: "816750000" })
  chain({ type: "seller.record", seller: A.coastal, cleanLots: 0, noShows: 1, proven: false })
  agents({
    type: "agent.intent",
    agentId: A.fjord,
    action: "pass",
    reason: "Skipping Coastal Catch, public record shows a no-show",
  })
  chain({
    type: "signal",
    id: "sig-quiet-bergen",
    kind: "demand_dip",
    place: "bergen",
    severity: 1,
    label: "Quiet dock: demand down after the storm",
    expiresAtBlock: block + 300,
  })
  chain({
    type: "signal",
    id: "sig-ref-marigold",
    kind: "reference",
    place: "mumbai",
    severity: 1,
    label: "New reference price for marigold",
    expiresAtBlock: block + 300,
  })
  agents({ type: "clock", block, phase: "night" })
  return out
}

export const serializeDay = (envelopes: TownEnvelope[]) => envelopes.map((e) => JSON.stringify(e)).join("\n") + "\n"
