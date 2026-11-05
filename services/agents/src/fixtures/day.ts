import {
  MARKET_OF_SECTOR,
  UNITS,
  splitPayout,
  toBase,
  type Building,
  type Commodity,
  type Currency,
  type Grade,
  type Persona,
  type Place,
  type Sector,
  type TownEnvelope,
  type TownEvent,
} from "@fairtown/shared"
import { keccak256, toHex } from "viem"
import { persona as P, PERSONAS, fixtureAgentId } from "./personas"

const BASE_TS = Date.UTC(2026, 10, 6, 23, 30)
const BLOCK_MS = 2000
const FEE_BPS = 100n
const WALKIN = { agentId: fixtureAgentId("walkin_visitor_1"), name: "Visitor 1" }

type Who = { agentId: string; name: string }
type BidSpec = { who: Who; max: string; amount: string }
type SaleSpec = {
  seller: Persona
  sector: Sector
  commodity: Commodity
  qty: bigint
  place: Place
  currency: Currency
  floor: string
  grade: Grade
  duration: number
  pickup: number
  parent?: string
  bids: BidSpec[]
  clearing: string
  winners: Array<{ who: Who; units: bigint }>
  advanceBps: number
}
export type Sale = { lotId: string; seller: Persona; sold: bigint; held: bigint; heldLeft: bigint; pickupDeadline: number }

class Day {
  readonly out: TownEnvelope[] = []
  block = 1
  private n = 0
  private txn = 0
  private lotSeq = 0
  private disputeSeq = 0

  emit(event: TownEvent, source: TownEnvelope["source"] = "chain", gap = 1) {
    this.block += gap
    this.out.push({
      v: 1,
      id: `day-${String(++this.n).padStart(4, "0")}`,
      ts: BASE_TS + this.block * BLOCK_MS,
      block: this.block,
      source,
      event,
    })
  }
  tx() {
    return keccak256(toHex(`day-tx-${++this.txn}`))
  }
  clock(phase?: "dawn" | "morning" | "noon" | "evening" | "night") {
    this.emit({ type: "clock", block: this.block + 1, ...(phase ? { phase } : {}) }, "agents")
  }
  // Time passes; the town gets a clock tick every `every` blocks.
  wait(blocks: number, every = 15) {
    const end = this.block + blocks
    while (this.block + every < end) this.emit({ type: "clock", block: this.block + every }, "agents", every)
    this.block = end
  }
  intent(who: Who, action: "bid" | "pass" | "list" | "relist" | "move" | "handover" | "report_no_show", reason: string, extra: { moveTo?: Building; lotId?: string } = {}) {
    this.emit({ type: "agent.intent", agentId: who.agentId, action, reason, ...extra }, "agents")
  }
  record(who: Persona, cleanLots: number, noShows: number, proven: boolean) {
    this.emit({ type: "seller.record", seller: who.fixtureAgentId, cleanLots, noShows, proven })
  }

  sale(s: SaleSpec): Sale {
    const lotId = String(++this.lotSeq)
    const building = MARKET_OF_SECTOR[s.sector]
    const listedAt = this.block + 1
    this.emit({
      type: "lot.listed",
      lotId,
      building,
      sector: s.sector,
      commodity: s.commodity,
      qty: Number(s.qty),
      unit: UNITS[s.sector],
      currency: s.currency,
      place: s.place,
      floorPerUnit: toBase(s.floor).toString(),
      seller: s.seller.fixtureAgentId,
      sellerName: s.seller.name,
      auction: `0x${keccak256(toHex(`auction-${lotId}`)).slice(-40)}`,
      endBlock: listedAt + s.duration,
      parentLotId: s.parent ?? "0",
      grade: s.grade,
    })
    const endBlock = listedAt + s.duration
    for (const b of s.bids) {
      this.intent(b.who, "bid", `Bidding up to ${b.max} ${s.currency}/${UNITS[s.sector]}`, { lotId })
      this.emit({ type: "bid.placed", lotId, agentId: b.who.agentId, maxPerUnit: toBase(b.max).toString(), amount: toBase(b.amount).toString(), tx: this.tx() }, "chain", 2)
      this.emit({ type: "price.tick", lotId, clearingPerUnit: toBase(s.clearing).toString() })
    }
    if (endBlock > this.block) this.wait(endBlock - this.block)
    const clearing = toBase(s.clearing)
    const sold = s.winners.reduce((a, w) => a + w.units, 0n)
    const raised = sold * clearing
    const { fee, advance, held } = splitPayout(raised, FEE_BPS, BigInt(s.advanceBps))
    const pickupDeadline = endBlock + s.pickup
    this.emit({
      type: "lot.settled",
      lotId,
      finalClearingPerUnit: (sold > 0n ? clearing : 0n).toString(),
      avgPerUnit: (sold > 0n ? clearing : 0n).toString(),
      soldUnits: sold.toString(),
      sellerPaid: advance.toString(),
      held: held.toString(),
      fee: fee.toString(),
      advanceBps: s.advanceBps,
      pickupDeadline,
      tx: this.tx(),
    })
    if (sold > 0n && (s.sector === "fish" || s.sector === "produce" || s.sector === "flowers"))
      this.emit({ type: "transport.needed", lotId, fromBuilding: building, place: s.place, qty: sold.toString() })
    return { lotId, seller: s.seller, sold, held, heldLeft: held, pickupDeadline }
  }

  // Releases the buyer's share of held money; the last share takes what's left.
  handover(sale: Sale, buyer: Who, receiver: Who, units: bigint, last: boolean) {
    const released = last ? sale.heldLeft : (sale.held * units) / sale.sold
    sale.heldLeft -= released
    this.emit({ type: "handover.confirmed", lotId: sale.lotId, buyer: buyer.agentId, receiver: receiver.agentId, releasedToSeller: released.toString(), tx: this.tx() }, "chain", 3)
    return released
  }
  peekLotId() {
    return String(this.lotSeq + 1)
  }
  nextDispute() {
    return String(++this.disputeSeq)
  }
}

const who = (p: Persona): Who => ({ agentId: p.fixtureAgentId, name: p.name })

export function buildDay(): TownEnvelope[] {
  const d = new Day()

  // ---------- opening ----------
  d.clock("dawn")
  for (const p of PERSONAS)
    d.emit({ type: "agent.spawned", agentId: p.fixtureAgentId, name: p.name, role: p.role, building: p.building, sprite: p.sprite }, "agents")
  for (const [currency, perUsd] of [["EUR", 0.92], ["NOK", 10.9], ["INR", 84.2], ["KES", 129.1], ["NGN", 1550]] as const)
    d.emit({ type: "fx.updated", currency, perUsd })
  for (const [commodity, market, perUnit, currency, source] of [
    ["cod", "bergen", "8.30", "EUR", "rafisklaget"],
    ["tomato", "lagos", "0.38", "USD", "illustrative"],
    ["marigold", "mumbai", "0.95", "USD", "illustrative"],
    ["gpu_hour", "any_dc", "2.00", "USD", "illustrative"],
    ["truck_capacity", "dallas", "0.055", "USD", "illustrative"],
  ] as const)
    d.emit({ type: "reference.updated", commodity, market, perUnit: toBase(perUnit).toString(), currency, source })
  d.record(P("pedro"), 3, 0, true)
  d.record(P("maya"), 3, 0, true)

  // ---------- 1. Bergen cod clock ----------
  const ingrid = P("ingrid"), hanse = P("hanse_kitchen"), fjord = P("fjord_processing"), oslo = P("oslo_fiskehall"), lars = P("lars")
  d.clock("morning")
  d.emit({ type: "signal", id: "1", kind: "weather", place: "bergen", severity: 3, label: "Storm warning, Bergen (forced for demo)", expiresAtBlock: d.block + 900 })
  for (const b of [hanse, fjord, oslo]) d.intent(who(b), "move", "Storm coming, fresh cod will be scarce", { moveTo: "fish_dock" })
  d.intent(who(ingrid), "list", "600 kg cod, grade A, landed 04:40")
  const cod = d.sale({
    seller: ingrid, sector: "fish", commodity: "cod", qty: 600n, place: "bergen", currency: "EUR", floor: "7.50", grade: "fresh_a",
    duration: 45, pickup: 300,
    bids: [{ who: who(oslo), max: "8.00", amount: "2000" }, { who: who(hanse), max: "9.40", amount: "2730" }, { who: who(fjord), max: "9.10", amount: "2730" }],
    clearing: "9.10", winners: [{ who: who(hanse), units: 300n }, { who: who(fjord), units: 300n }], advanceBps: 5000,
  })
  d.intent(who(lars), "list", "Reefer free, Bergen to Oslo", { moveTo: "freight_yard" })
  const truck = d.sale({
    seller: lars, sector: "truck", commodity: "truck_capacity", qty: 300n, place: "bergen", currency: "EUR", floor: "0.80", grade: "na",
    duration: 30, pickup: 300, parent: cod.lotId,
    bids: [{ who: who(hanse), max: "0.85", amount: "255" }], clearing: "0.85", winners: [{ who: who(hanse), units: 300n }], advanceBps: 1000,
  })
  d.emit({ type: "carrier.assigned", lotId: cod.lotId, truckLotId: truck.lotId, carrier: lars.fixtureAgentId })
  d.intent(who(lars), "handover", "At the dock, scanning Ingrid's code", { lotId: cod.lotId, moveTo: "fish_dock" })
  d.handover(cod, who(hanse), who(lars), 300n, false)
  d.wait(40)
  d.intent(who(hanse), "handover", "Truck arrived in Oslo, scanning Lars's code", { lotId: truck.lotId })
  d.handover(truck, who(hanse), who(hanse), 300n, true)
  d.emit({ type: "lot.delivered", lotId: cod.lotId, truckLotId: truck.lotId })
  d.record(lars, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: truck.lotId })
  d.intent(who(fjord), "handover", "Collecting my 300 kg at the dock", { lotId: cod.lotId })
  d.handover(cod, who(fjord), who(fjord), 300n, true)
  d.emit({ type: "lot.delivered", lotId: cod.lotId, truckLotId: "0" })
  d.record(ingrid, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: cod.lotId })

  // ---------- 2. The empty run home ----------
  const maya = P("maya"), gulf = P("gulf_produce")
  d.clock("noon")
  d.intent(who(maya), "list", "Empty run home: 18 t of space, Dallas to Houston", { moveTo: "freight_yard" })
  d.intent(who(gulf), "move", "Cheap space to Houston today", { moveTo: "freight_yard" })
  const run = d.sale({
    seller: maya, sector: "truck", commodity: "truck_capacity", qty: 18000n, place: "dallas", currency: "USD", floor: "0.05", grade: "na",
    duration: 30, pickup: 300,
    bids: [{ who: who(gulf), max: "0.06", amount: "1080" }], clearing: "0.06", winners: [{ who: who(gulf), units: 18000n }], advanceBps: 1000,
  })
  d.wait(60)
  d.intent(who(gulf), "handover", "Load arrived in Houston, scanning Maya's code", { lotId: run.lotId })
  d.handover(run, who(gulf), who(gulf), 18000n, true)
  d.emit({ type: "lot.delivered", lotId: run.lotId, truckLotId: "0" })
  d.record(maya, 4, 0, true)
  d.emit({ type: "lot.paid_in_full", lotId: run.lotId })

  // ---------- 3. The GPU going dark ----------
  const north = P("northlight"), atlas = P("atlas_labs"), kestrel = P("kestrel_ai"), vector = P("vector_mind")
  d.clock("night")
  d.intent(who(north), "list", "200 idle GPU hours from 02:00 (simulated provider)")
  for (const b of [atlas, kestrel, vector]) d.intent(who(b), "move", "Idle GPUs listed", { moveTo: "compute_yard" })
  const gpu = d.sale({
    seller: north, sector: "compute", commodity: "gpu_hour", qty: 200n, place: "any_dc", currency: "USD", floor: "1.80", grade: "gpu_verified",
    duration: 30, pickup: 60,
    bids: [{ who: who(kestrel), max: "1.95", amount: "390" }, { who: who(vector), max: "2.00", amount: "400" }, { who: who(atlas), max: "2.10", amount: "420" }],
    clearing: "2.10", winners: [{ who: who(atlas), units: 200n }], advanceBps: 5000,
  })
  d.intent(who(vector), "pass", "Clearing is above my compute budget", { lotId: gpu.lotId })
  d.intent(who(atlas), "handover", "Access ticket received, health check passed (simulated)", { lotId: gpu.lotId })
  d.handover(gpu, who(atlas), who(atlas), 200n, true)
  d.emit({ type: "lot.delivered", lotId: gpu.lotId, truckLotId: "0" })
  d.record(north, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: gpu.lotId })
  const gpu2 = d.sale({
    seller: north, sector: "compute", commodity: "gpu_hour", qty: 50n, place: "any_dc", currency: "USD", floor: "1.80", grade: "gpu_verified",
    duration: 30, pickup: 60,
    bids: [{ who: who(kestrel), max: "1.90", amount: "95" }], clearing: "1.90", winners: [{ who: who(kestrel), units: 50n }], advanceBps: 5000,
  })
  d.wait(gpu2.pickupDeadline - d.block + 1)
  d.intent(who(kestrel), "report_no_show", "Health check failed at start time", { lotId: gpu2.lotId })
  d.emit({ type: "noshow.reported", lotId: gpu2.lotId, buyer: kestrel.fixtureAgentId, contestEnds: d.block + 61 })
  const gpuDispute = d.nextDispute()
  d.emit({ type: "dispute.opened", disputeId: gpuDispute, lotId: gpu2.lotId, buyer: kestrel.fixtureAgentId, kind: "no_show" }, "chain", 5)
  d.emit({ type: "noshow.contested", lotId: gpu2.lotId, buyer: kestrel.fixtureAgentId, disputeId: gpuDispute })
  d.wait(20)
  d.emit({ type: "dispute.resolved", disputeId: gpuDispute, lotId: gpu2.lotId, refundBps: 0 })
  d.record(north, 2, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: gpu2.lotId })

  // ---------- 4. The Diwali marigold rush ----------
  const ganesh = P("ganesh"), dadar = P("dadar_traders"), pune = P("pune_phool")
  d.clock("morning")
  d.emit({ type: "signal", id: "2", kind: "festival", place: "pune", severity: 2, label: "Diwali in 3 days", expiresAtBlock: d.block + 2000 })
  for (const b of [dadar, pune]) d.intent(who(b), "move", "Diwali demand is up", { moveTo: "flower_hall" })
  d.intent(who(ganesh), "list", "2 tonnes marigold, class 1")
  d.emit({ type: "human.joined", agentId: WALKIN.agentId, name: WALKIN.name }, "agents")
  const mari = d.sale({
    seller: ganesh, sector: "flowers", commodity: "marigold", qty: 2000n, place: "pune", currency: "USD", floor: "0.90", grade: "class_1",
    duration: 60, pickup: 300,
    bids: [{ who: who(pune), max: "1.00", amount: "500" }, { who: who(dadar), max: "1.20", amount: "1800" }, { who: WALKIN, max: "1.25", amount: "600" }],
    clearing: "1.20", winners: [{ who: who(dadar), units: 1500n }, { who: WALKIN, units: 500n }], advanceBps: 5000,
  })
  d.intent(who(dadar), "handover", "Collecting 1.5 t for the Dadar stalls", { lotId: mari.lotId })
  d.handover(mari, who(dadar), who(dadar), 1500n, false)
  d.emit({ type: "lot.delivered", lotId: mari.lotId, truckLotId: "0" })
  d.handover(mari, WALKIN, WALKIN, 500n, true)
  d.record(ganesh, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: mari.lotId })

  // ---------- 5. The rose flight (seeded) ----------
  const wanjiru = P("wanjiru"), bloom = P("bloom_co"), amstel = P("amstel_bloemen"), cargo = P("nairobi_air_cargo")
  d.clock("noon")
  d.emit({ type: "signal", id: "3", kind: "festival", place: "nairobi", severity: 2, label: "Valentine's cargo cutoff (forced for demo)", expiresAtBlock: d.block + 1500 })
  for (const b of [bloom, amstel]) d.intent(who(b), "move", "Valentine's roses on offer", { moveTo: "flower_hall" })
  const rose = d.sale({
    seller: wanjiru, sector: "flowers", commodity: "rose", qty: 500n, place: "nairobi", currency: "EUR", floor: "4.00", grade: "bloom_a",
    duration: 60, pickup: 300,
    bids: [{ who: who(amstel), max: "4.20", amount: "1000" }, { who: who(bloom), max: "4.80", amount: "2400" }],
    clearing: "4.80", winners: [{ who: who(bloom), units: 500n }], advanceBps: 5000,
  })
  d.intent(who(cargo), "list", "Cargo slot on tonight's Amsterdam flight", { moveTo: "freight_yard" })
  const slot = d.sale({
    seller: cargo, sector: "truck", commodity: "cargo_slot", qty: 500n, place: "nairobi", currency: "EUR", floor: "1.50", grade: "na",
    duration: 30, pickup: 300, parent: rose.lotId,
    bids: [{ who: who(bloom), max: "1.60", amount: "800" }], clearing: "1.60", winners: [{ who: who(bloom), units: 500n }], advanceBps: 1000,
  })
  d.emit({ type: "carrier.assigned", lotId: rose.lotId, truckLotId: slot.lotId, carrier: cargo.fixtureAgentId })
  d.handover(rose, who(bloom), who(cargo), 500n, true)
  d.wait(50)
  d.handover(slot, who(bloom), who(bloom), 500n, true)
  d.emit({ type: "lot.delivered", lotId: rose.lotId, truckLotId: slot.lotId })
  d.record(cargo, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: slot.lotId })
  d.record(wanjiru, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: rose.lotId })

  // ---------- 6. Lagos tomatoes (seeded) ----------
  const amina = P("amina"), mile12 = P("mile12_coop"), shanti = P("shanti_niwas"), eko = P("eko_court"), hub = P("lagos_cold_hub")
  d.clock("morning")
  d.emit({ type: "signal", id: "4", kind: "demand_dip", place: "lagos", severity: 2, label: "Tomato glut at Mile 12", expiresAtBlock: d.block + 1200 })
  for (const b of [mile12, shanti, eko]) d.intent(who(b), "move", "Tomatoes are cheap today", { moveTo: "harvest_hall" })
  const tom = d.sale({
    seller: amina, sector: "produce", commodity: "tomato", qty: 3000n, place: "lagos", currency: "USD", floor: "0.40", grade: "class_1",
    duration: 90, pickup: 450,
    bids: [{ who: who(eko), max: "0.45", amount: "90" }, { who: who(shanti), max: "0.50", amount: "100" }, { who: who(mile12), max: "0.55", amount: "1400" }],
    clearing: "0.50", winners: [{ who: who(mile12), units: 2800n }, { who: who(shanti), units: 200n }], advanceBps: 5000,
  })
  d.emit({ type: "storage.needed", lotId: tom.lotId, requester: mile12.fixtureAgentId, qty: "2800", days: 3 })
  d.intent(who(hub), "list", "20 slot-days of cold room for the glut")
  const cold = d.sale({
    seller: hub, sector: "storage", commodity: "storage_slot", qty: 20n, place: "lagos", currency: "USD", floor: "5.00", grade: "na",
    duration: 30, pickup: 150, parent: tom.lotId,
    bids: [{ who: who(mile12), max: "6.00", amount: "120" }], clearing: "6.00", winners: [{ who: who(mile12), units: 20n }], advanceBps: 5000,
  })
  d.handover(tom, who(mile12), who(mile12), 2800n, false)
  d.emit({ type: "lot.delivered", lotId: tom.lotId, truckLotId: "0" })
  d.handover(cold, who(mile12), who(mile12), 20n, true)
  d.emit({ type: "lot.delivered", lotId: cold.lotId, truckLotId: "0" })
  d.record(hub, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: cold.lotId })
  const quality = d.nextDispute()
  d.intent(who(shanti), "pass", "Half the crates are bruised; disputing quality", { lotId: tom.lotId })
  d.emit({ type: "dispute.opened", disputeId: quality, lotId: tom.lotId, buyer: shanti.fixtureAgentId, kind: "quality" })
  d.wait(30)
  d.emit({ type: "dispute.resolved", disputeId: quality, lotId: tom.lotId, refundBps: 2500 })
  const late = d.sale({
    seller: amina, sector: "produce", commodity: "tomato", qty: 1000n, place: "lagos", currency: "USD", floor: "0.40", grade: "class_2",
    duration: 90, pickup: 450, bids: [], clearing: "0.40", winners: [], advanceBps: 5000,
  })
  d.intent(who(amina), "relist", "No bids; dropping the floor 15%", { lotId: late.lotId })
  d.emit({ type: "lot.relisted", lotId: late.lotId, newLotId: d.peekLotId(), newFloorPerUnit: toBase("0.34").toString() })
  const relisted = d.sale({
    seller: amina, sector: "produce", commodity: "tomato", qty: 1000n, place: "lagos", currency: "USD", floor: "0.34", grade: "class_2",
    duration: 90, pickup: 450, parent: late.lotId,
    bids: [{ who: who(eko), max: "0.36", amount: "360" }], clearing: "0.36", winners: [{ who: who(eko), units: 1000n }], advanceBps: 5000,
  })
  d.handover(relisted, who(eko), who(eko), 1000n, true)
  d.emit({ type: "lot.delivered", lotId: relisted.lotId, truckLotId: "0" })
  d.record(amina, 1, 0, false)
  d.emit({ type: "lot.paid_in_full", lotId: relisted.lotId })

  // ---------- 7. The no-show ----------
  const coastal = P("coastal_catch")
  d.clock("evening")
  d.intent(who(coastal), "list", "400 kg haddock, ready now")
  const hadd = d.sale({
    seller: coastal, sector: "fish", commodity: "haddock", qty: 400n, place: "bergen", currency: "EUR", floor: "6.00", grade: "fresh_a",
    duration: 45, pickup: 300,
    bids: [{ who: who(oslo), max: "6.20", amount: "500" }, { who: who(fjord), max: "6.50", amount: "2600" }],
    clearing: "6.50", winners: [{ who: who(fjord), units: 400n }], advanceBps: 5000,
  })
  d.wait(hadd.pickupDeadline - d.block + 1, 50)
  d.intent(who(fjord), "report_no_show", "Coastal Catch never handed over; reporting", { lotId: hadd.lotId })
  d.emit({ type: "noshow.reported", lotId: hadd.lotId, buyer: fjord.fixtureAgentId, contestEnds: d.block + 61 })
  d.wait(61, 20)
  d.emit({ type: "noshow.refunded", lotId: hadd.lotId, seller: coastal.fixtureAgentId, buyer: fjord.fixtureAgentId, refund: hadd.heldLeft.toString() })
  d.record(coastal, 0, 1, false)
  const after = d.sale({
    seller: coastal, sector: "fish", commodity: "haddock", qty: 300n, place: "bergen", currency: "EUR", floor: "6.00", grade: "fresh_a",
    duration: 45, pickup: 300, bids: [], clearing: "6.00", winners: [], advanceBps: 5000,
  })
  for (const b of [hanse, fjord, oslo]) d.intent(who(b), "pass", "Coastal Catch has a recent no-show", { lotId: after.lotId })
  d.clock("night")

  return d.out
}
