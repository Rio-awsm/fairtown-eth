import { fromKey, UNIT, type Building, type Commodity, type Currency, type Persona, type Place, type Sector, type TownEvent } from "@fairtown/shared"
import type { Address } from "viem"
import type { ChainAdapter, ChainEvent, EventArgs, LotSpecInput } from "../chain/types"
import { PERSONAS } from "../fixtures/personas"
import { issueTicket } from "../handover/tickets"
import { findReference, type ReferenceRow } from "../listing/references"
import type { Publisher } from "../runtime/publisher"
import type { AgentRuntime } from "../runtime/runtime"
import type { Wallets } from "../runtime/wallets"
import { healthCheck, issueAccess, SIMULATED_LABEL, type AccessRecord } from "./compute"
import { DEFAULT_RULES, dutyMax, FAMILIES, GOODS, pickTruck, poolSplit, pooledQty, relistFloor, slotDays, type SectorRules, type TruckState } from "./rules"

const lc = (a: string) => a.toLowerCase() as Address
const ZERO = "0x0000000000000000000000000000000000000000" as Address

type LotInfo = {
  lotId: bigint
  seller: Address
  sector: Sector
  commodity: Commodity
  market: Building
  place: Place
  currency: Currency
  qty: bigint
  floor: bigint
  firstFloor: bigint
  relists: number
  parentLotId: bigint
  holders: Map<Address, bigint>
}

export type SectorEngineOptions = {
  chain: ChainAdapter
  wallets: Pick<Wallets, "queue">
  publisher: Publisher
  runtime: AgentRuntime
  personas?: Persona[]
  rules?: Partial<SectorRules>
  references?: ReferenceRow[]
  fileDispute?: (buyer: Address, lotId: bigint, tokenAmount: bigint) => Promise<{ disputeId: bigint }>
  onError?: (what: string, err: unknown) => void
  // Restart: events up to this block are history. State is rebuilt from them; one-time actions (list a truck or storage
  // lot, request storage, relist) wait until the feed has caught up and run only if the chain shows they never happened.
  replayUntil?: bigint
  caughtUpTo?: () => bigint | undefined
}

type Task = { at: bigint; what: string; run: () => Promise<void> }

// Chained, sector and trust behaviours (guide 2 step 5.2). Event-driven; timed steps (walking, driving, deadlines) go
// through a block scheduler. Bids only through the runtime (duties + guardrails); tickets only through src/handover.
export class SectorEngine {
  readonly rules: SectorRules
  readonly trucks: TruckState[]
  readonly access = new Map<string, AccessRecord[]>()
  readonly splits = new Map<string, Array<{ name: string; qty: bigint; units: bigint }>>()
  readonly log: string[] = []
  private readonly lots = new Map<string, LotInfo>()
  private readonly byAuction = new Map<Address, bigint>()
  private readonly truckOf = new Map<string, TruckState>() // parent lot -> truck carrying it
  private readonly storageFor = new Map<string, Address>() // parent lot -> requester
  private readonly disputeLots = new Set<string>()
  private readonly failingCompute = new Set<string>()
  private tasks: Task[] = []
  private deferred: Task[] = []
  private replayed = false
  private readonly storageRequested = new Set<string>() // lotId:requester
  private q: Promise<void> = Promise.resolve()
  private unwatch?: () => void
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly o: SectorEngineOptions) {
    this.rules = { ...DEFAULT_RULES, ...o.rules }
    this.trucks = this.personas()
      .filter((p) => p.kind === "truck")
      .map((p) => ({
        agentId: this.addr(p.id),
        id: p.id,
        home: p.place,
        at: p.place,
        busy: false,
        currency: p.currency,
        commodity: p.id === "nairobi_air_cargo" ? "cargo_slot" : "truck_capacity",
      }))
    // Society agents bid once for the pooled family order.
    for (const [id, fam] of Object.entries(FAMILIES)) {
      const a = this.o.runtime.agents.get(this.addr(id))
      if (a?.mandate) this.o.runtime.patch(a.agentId, { mandate: { qty: pooledQty(fam).toString() } })
    }
  }

  // ---------- scenario flags ----------
  flagDispute(lotId: bigint) {
    this.disputeLots.add(lotId.toString())
  }
  failCompute(lotId: bigint) {
    this.failingCompute.add(lotId.toString())
  }

  // ---------- lifecycle ----------
  start(tickMs = 1000) {
    this.unwatch = this.o.chain.watch((e) => this.handle(e))
    this.timer = setInterval(() => void this.step().catch((e) => this.fail("engine step", e)), tickMs)
    this.timer.unref?.()
    return () => this.stop()
  }
  watchOnly() {
    this.unwatch = this.o.chain.watch((e) => this.handle(e))
    return () => this.unwatch?.()
  }
  stop() {
    this.unwatch?.()
    if (this.timer) clearInterval(this.timer)
  }
  handle(e: ChainEvent) {
    this.q = this.q.then(() => this.onEvent(e)).catch((err) => this.fail(`event ${e.eventName}`, err))
  }
  idle() {
    return this.q
  }
  pending() {
    return this.tasks.map((t) => ({ at: t.at, what: t.what }))
  }

  private isHistory(block: bigint) {
    return !this.replayed && this.o.replayUntil !== undefined && block <= this.o.replayUntil
  }
  private onceLive(block: bigint, what: string, run: () => Promise<void>) {
    if (this.isHistory(block)) this.deferred.push({ at: block, what, run })
    else return run()
  }
  replaying() {
    return !this.replayed && this.o.replayUntil !== undefined
  }

  async step() {
    await this.idle()
    if (this.replaying() && (this.o.caughtUpTo?.() ?? -1n) >= this.o.replayUntil!) {
      this.replayed = true
      const todo = this.deferred
      this.deferred = []
      for (const t of todo) {
        try {
          await t.run()
        } catch (err) {
          this.fail(`deferred ${t.what}`, err)
        }
      }
    }
    const block = await this.o.chain.blockNumber()
    const due = this.tasks.filter((t) => t.at <= block).sort((a, b) => (a.at < b.at ? -1 : 1))
    this.tasks = this.tasks.filter((t) => t.at > block)
    for (const t of due) {
      try {
        await t.run()
      } catch (err) {
        this.fail(t.what, err)
      }
    }
    await this.idle()
  }

  // Standalone capacity (Dallas run) and GPU hours (scene 3): listed by the director or a seller message.
  async listCapacity(truckId: string, qty: bigint, floorPerUnit: bigint, place?: Place) {
    const t = this.trucks.find((x) => x.id === truckId)
    if (!t) throw new Error(`No truck ${truckId}`)
    return this.list(t.agentId, { sector: "truck", market: "freight_yard", commodity: t.commodity, grade: "na", place: (place ?? t.at) as Place, currency: t.currency, qty, floorPerUnit, parentLotId: 0n }, `${qty} kg of space from ${place ?? t.at}`)
  }
  async listCompute(providerId: string, hours: bigint, floorPerUnit: bigint) {
    const p = this.personas().find((x) => x.id === providerId && x.kind === "compute_provider")
    if (!p) throw new Error(`No compute provider ${providerId}`)
    return this.list(this.addr(p.id), { sector: "compute", market: "compute_yard", commodity: "gpu_hour", grade: "gpu_verified", place: p.place, currency: p.currency, qty: hours, floorPerUnit, parentLotId: 0n }, `${hours} GPU hours (${SIMULATED_LABEL})`)
  }

  // A persona lists goods (director scenes, load test). Durations and pickup windows come from the sector rules.
  async listFor(personaId: string, s: Omit<LotSpecInput, "durationBlocks" | "pickupWindowBlocks" | "seller" | "metadataURI" | "parentLotId">, reason: string) {
    const seller = this.addr(personaId)
    if (seller === ZERO) throw new Error(`No persona ${personaId}`)
    return this.list(seller, { ...s, parentLotId: 0n }, reason)
  }

  // Buyers still holding a lot's tokens (the handover "winners", D-38): tracked from TokensClaimed, checked on chain.
  async winners(lotId: bigint): Promise<Array<{ buyer: Address; tokenAmount: bigint }>> {
    const lot = this.lots.get(lotId.toString())
    if (!lot) return []
    const out: Array<{ buyer: Address; tokenAmount: bigint }> = []
    for (const [buyer] of lot.holders) {
      const tokenAmount = await this.o.chain.tokenBalance(lotId, buyer)
      if (tokenAmount > 0n) out.push({ buyer, tokenAmount })
    }
    return out
  }

  // ---------- events ----------
  private async onEvent(e: ChainEvent) {
    switch (e.eventName) {
      case "LotListed":
        return this.onListed(e.args)
      case "TokensClaimed": {
        const lotId = this.byAuction.get(lc(e.address))
        const lot = lotId !== undefined ? this.lots.get(lotId.toString()) : undefined
        if (lot) lot.holders.set(lc(e.args.owner), (lot.holders.get(lc(e.args.owner)) ?? 0n) + e.args.tokensFilled)
        return
      }
      case "LotSettled":
        return this.onSettled(e.args, e.blockNumber)
      case "TransportNeeded":
        return this.onTransportNeeded(e.args, e.blockNumber)
      case "CarrierAssigned":
        return this.onCarrierAssigned(e.args, e.blockNumber)
      case "StorageNeeded":
        return this.onStorageNeeded(e.args, e.blockNumber)
      case "LotDelivered": {
        const truckLot = this.lots.get(e.args.truckLotId.toString())
        if (e.args.truckLotId > 0n && truckLot) this.freeTruck(e.args.lotId, topHolder(truckLot))
        return
      }
      default:
        return
    }
  }

  private async onListed(a: EventArgs<"LotListed">) {
    const state = await this.o.chain.getLot(a.lotId)
    const parent = a.parentLotId > 0n ? this.lots.get(a.parentLotId.toString()) : undefined
    const sector = fromKey(a.sector) as Sector
    const relisted = parent !== undefined && GOODS.includes(sector) && parent.sector === sector
    const lot: LotInfo = {
      lotId: a.lotId,
      seller: lc(a.seller),
      sector,
      commodity: fromKey(a.commodity) as Commodity,
      market: fromKey(a.market) as Building,
      place: fromKey(a.place) as Place,
      currency: state.spec.currency,
      qty: a.qty,
      floor: a.floorPerUnit,
      firstFloor: relisted ? parent.firstFloor : a.floorPerUnit,
      relists: relisted ? parent.relists + 1 : 0,
      parentLotId: a.parentLotId,
      holders: new Map(),
    }
    this.lots.set(a.lotId.toString(), lot)
    this.byAuction.set(lc(a.auction), a.lotId)
    if (!parent || relisted) return
    if (sector === "truck") {
      const t = this.trucks.find((x) => x.agentId === lot.seller)
      if (t) {
        t.busy = true
        this.truckOf.set(parent.lotId.toString(), t)
      }
    }
    // A chained truck or storage lot: the parent's buyer gets a duty to bid on it, inside guardrails.
    const buyer = sector === "truck" ? topHolder(parent) : sector === "storage" ? this.storageFor.get(parent.lotId.toString()) : undefined
    if (!buyer) return
    const max = dutyMax(lot.floor, this.rules.dutyMaxBps)
    this.o.runtime.assignDuty(buyer, lot.lotId, { commodities: [lot.commodity], maxPerUnit: max.toString(), qty: lot.qty.toString(), avoidNoShowSellers: false })
  }

  private async onSettled(a: EventArgs<"LotSettled">, block: bigint) {
    const lot = this.lots.get(a.lotId.toString())
    if (!lot) return
    if (a.soldUnits < lot.qty) await this.onceLive(block, `relist lot ${lot.lotId}`, () => this.maybeRelist(lot, lot.qty - a.soldUnits))
    if (a.soldUnits === 0n) {
      const parent = lot.sector === "truck" && lot.parentLotId > 0n ? this.lots.get(lot.parentLotId.toString()) : undefined
      if (parent) {
        // Nobody booked the truck: the buyer collects at the dock instead.
        this.freeTruck(parent.lotId)
        this.at(block + this.rules.arriveBlocks, `direct pickup lot ${parent.lotId}`, () => this.directHandover(parent))
      }
      return
    }
    this.at(a.pickupDeadline + 1n, `no-show check lot ${lot.lotId}`, () => this.reportNoShows(lot))
    const arrive = block + this.rules.arriveBlocks
    if (GOODS.includes(lot.sector)) {
      for (const [h] of lot.holders)
        if (this.o.runtime.agents.get(h)?.mandate?.commodities.includes("storage_slot"))
          await this.onceLive(block, `storage request lot ${lot.lotId}`, async () => this.at(block + 1n, `storage request lot ${lot.lotId}`, () => this.requestStorage(lot, h)))
    } else if (lot.sector === "compute") this.at(arrive, `compute access lot ${lot.lotId}`, () => this.computeAccess(lot))
    else if (lot.sector === "truck" && lot.parentLotId === 0n) this.at(block + this.rules.travelBlocks, `drop-off lot ${lot.lotId}`, () => this.directHandover(lot))
    else if (lot.sector === "storage") this.at(arrive, `check-in lot ${lot.lotId}`, () => this.directHandover(lot))
  }

  private async onTransportNeeded(a: EventArgs<"TransportNeeded">, block: bigint) {
    const parent = this.lots.get(a.lotId.toString())
    if (!parent) return
    return this.onceLive(block, `transport for lot ${parent.lotId}`, () => this.arrangeTransport(parent, a, block))
  }

  private async arrangeTransport(parent: LotInfo, a: EventArgs<"TransportNeeded">, block: bigint) {
    if (this.childOf(parent.lotId, "truck")) return // already booked (seen on chain, e.g. before a restart)
    const truck = pickTruck(this.trucks, parent.place, parent.currency)
    if (!truck) {
      this.at(block + this.rules.arriveBlocks, `direct pickup lot ${parent.lotId}`, () => this.directHandover(parent))
      return
    }
    truck.busy = true
    this.truckOf.set(parent.lotId.toString(), truck)
    const ref = findReference(this.o.references ?? [], truck.commodity, parent.place)
    const floor = ref && ref.currency === parent.currency ? BigInt(ref.perUnit) : this.rules.capacityFloor[parent.currency]
    await this.list(
      truck.agentId,
      { sector: "truck", market: "freight_yard", commodity: truck.commodity, grade: "na", place: parent.place, currency: parent.currency, qty: a.qty, floorPerUnit: floor, parentLotId: parent.lotId },
      `Carrying lot ${parent.lotId} from ${parent.place}`,
    )
  }

  private async onCarrierAssigned(a: EventArgs<"CarrierAssigned">, block: bigint) {
    const parent = this.lots.get(a.lotId.toString())
    const truckLot = this.lots.get(a.truckLotId.toString())
    if (!parent || !truckLot) return
    const carrier = lc(a.carrier)
    await this.intent(carrier, "move", parent.lotId, `Driving to ${parent.market} for lot ${parent.lotId}`, parent.market)
    this.at(block + this.rules.arriveBlocks, `pickup lot ${parent.lotId}`, async () => {
      if (await this.pickup(parent, carrier)) this.at((await this.o.chain.blockNumber()) + this.rules.travelBlocks, `drop-off lot ${truckLot.lotId}`, () => this.directHandover(truckLot))
    })
  }

  private async onStorageNeeded(a: EventArgs<"StorageNeeded">, block: bigint) {
    const parent = this.lots.get(a.lotId.toString())
    if (!parent) return
    this.storageRequested.add(`${a.lotId}:${lc(a.requester)}`)
    this.storageFor.set(parent.lotId.toString(), lc(a.requester))
    return this.onceLive(block, `storage for lot ${parent.lotId}`, () => this.listStorage(parent, a))
  }

  private async listStorage(parent: LotInfo, a: EventArgs<"StorageNeeded">) {
    if (this.childOf(parent.lotId, "storage")) return
    const store = this.personas().find((p) => p.kind === "cold_store" && p.place === parent.place && p.currency === parent.currency)
    if (!store) return this.note(`no cold store at ${parent.place} for lot ${parent.lotId}`)
    const qty = slotDays(a.qty, this.rules.slotKg, a.days_)
    await this.list(
      this.addr(store.id),
      { sector: "storage", market: "cold_vault", commodity: "storage_slot", grade: "na", place: parent.place, currency: parent.currency, qty, floorPerUnit: this.rules.storageFloor[parent.currency], parentLotId: parent.lotId },
      `${qty} slot-days for lot ${parent.lotId}`,
    )
  }

  // ---------- behaviours ----------
  private async maybeRelist(lot: LotInfo, unsold: bigint) {
    const seller = this.persona(lot.seller)
    if (!seller || !["seller", "compute_provider"].includes(seller.kind) || !(GOODS.includes(lot.sector) || lot.sector === "compute")) return
    if (lot.relists >= this.rules.maxRelists) return this.note(`lot ${lot.lotId}: no more relists`)
    if (this.childOf(lot.lotId, lot.sector)) return // already relisted
    const next = relistFloor(lot.firstFloor, lot.floor, this.rules.relistStepBps, this.rules.relistMinBps)
    if (next === null) return this.note(`lot ${lot.lotId}: floor at minimum, not relisting`)
    await this.intent(lot.seller, "relist", lot.lotId, `${unsold} left, relisting ${money(next, lot.currency)} lower`.slice(0, 80))
    await this.o.wallets.queue(lot.seller, () => this.o.chain.relist(lot.seller, lot.lotId, next, this.rules.auctionBlocks[lot.sector]))
  }

  private async requestStorage(lot: LotInfo, holder: Address) {
    if (this.storageRequested.has(`${lot.lotId}:${holder}`)) return
    const tokens = await this.o.chain.tokenBalance(lot.lotId, holder)
    const need = this.o.runtime.agents.get(holder)?.mandate?.qty
    const units = tokens / UNIT - (need && lot.qty > BigInt(need) ? BigInt(need) : 0n)
    if (units <= 0n) return
    await this.intent(holder, "move", lot.lotId, `Won more than I can move today, booking cold storage`, "cold_vault")
    await this.o.wallets.queue(holder, () => this.o.chain.requestStorage(holder, lot.lotId, units, this.rules.storageDays))
  }

  // Seller's agent signs when the receiver arrives; the carrier confirms each buyer's share.
  private async pickup(parent: LotInfo, carrier: Address): Promise<boolean> {
    if (this.isNoShowSeller(parent.seller)) return this.note(`lot ${parent.lotId}: seller never shows (seeded)`), false
    let ok = false
    for (const [buyer] of parent.holders) {
      const tokens = await this.o.chain.tokenBalance(parent.lotId, buyer)
      if (tokens === 0n) continue
      await this.intent(parent.seller, "handover", parent.lotId, `Handing lot ${parent.lotId} to the truck`)
      const ticket = await issueTicket(this.o.chain, parent.seller, { lotId: parent.lotId, buyer, tokenAmount: tokens })
      await this.o.wallets.queue(carrier, () => this.o.chain.confirmHandover(carrier, ticket))
      await this.intent(carrier, "handover", parent.lotId, `Picked up lot ${parent.lotId}, on the road`)
      ok = true
    }
    return ok
  }

  // Receiver confirms directly: buyer pickup with no truck, drop-off of a truck lot, storage check-in.
  private async directHandover(lot: LotInfo) {
    if (this.isNoShowSeller(lot.seller)) return this.note(`lot ${lot.lotId}: seller never shows (seeded)`)
    for (const [buyer] of lot.holders) {
      const tokens = await this.o.chain.tokenBalance(lot.lotId, buyer)
      if (tokens === 0n) continue
      if (this.disputeLots.has(lot.lotId.toString()) && this.o.fileDispute) {
        await this.intent(buyer, "report_no_show", lot.lotId, `Quality isn't what was listed, filing a dispute`)
        await this.o.fileDispute(buyer, lot.lotId, tokens)
        continue
      }
      const ticket = await issueTicket(this.o.chain, lot.seller, { lotId: lot.lotId, buyer, tokenAmount: tokens })
      await this.o.wallets.queue(buyer, () => this.o.chain.confirmHandover(buyer, ticket))
      await this.intent(buyer, "handover", lot.lotId, handoverReason(lot))
      this.recordSplit(lot, buyer, tokens)
    }
    if (lot.sector === "truck" && lot.parentLotId > 0n) this.freeTruck(lot.parentLotId, topHolder(lot))
  }

  private async computeAccess(lot: LotInfo) {
    const block = await this.o.chain.blockNumber()
    const recs: AccessRecord[] = []
    for (const [buyer] of lot.holders) {
      const tokens = await this.o.chain.tokenBalance(lot.lotId, buyer)
      if (tokens === 0n) continue
      const rec = issueAccess(lot.lotId, buyer, tokens / UNIT, block)
      recs.push(rec)
      await this.intent(lot.seller, "handover", lot.lotId, `${SIMULATED_LABEL}: access issued`)
      const ticket = await issueTicket(this.o.chain, lot.seller, { lotId: lot.lotId, buyer, tokenAmount: tokens })
      const h = healthCheck(rec, this.failingCompute)
      if (!h.ok) {
        await this.intent(buyer, "pass", lot.lotId, `GPU health check failed, not confirming`)
        this.note(`lot ${lot.lotId}: ${h.detail}`)
        continue
      }
      await this.o.wallets.queue(buyer, () => this.o.chain.confirmHandover(buyer, ticket))
      await this.intent(buyer, "handover", lot.lotId, `GPUs healthy, confirming ${rec.gpuHours} hours`)
    }
    this.access.set(lot.lotId.toString(), recs)
  }

  // After the pickup deadline, any buyer still holding tokens reports; the keeper finalizes after the contest window.
  private async reportNoShows(lot: LotInfo) {
    const s = (await this.o.chain.getLot(lot.lotId)).settlement
    if (!s || s.heldRemaining === 0n) return
    for (const [buyer] of lot.holders) {
      const tokens = await this.o.chain.tokenBalance(lot.lotId, buyer)
      if (tokens === 0n) continue
      await this.intent(buyer, "report_no_show", lot.lotId, `No handover by the deadline, reporting a no-show`)
      await this.o.wallets.queue(buyer, () => this.o.chain.reportNoShow(buyer, lot.lotId, tokens))
    }
  }

  // ---------- helpers ----------
  private async list(seller: Address, s: Omit<LotSpecInput, "durationBlocks" | "pickupWindowBlocks" | "seller" | "metadataURI">, reason: string) {
    const spec: LotSpecInput = { ...s, durationBlocks: this.rules.auctionBlocks[s.sector], pickupWindowBlocks: this.rules.pickupBlocks[s.sector], seller, metadataURI: "" }
    await this.intent(seller, "list", undefined, reason.slice(0, 80), s.market)
    return this.o.wallets.queue(seller, () => this.o.chain.createLot(seller, spec))
  }

  private childOf(parentLotId: bigint, sector: Sector) {
    for (const l of this.lots.values()) if (l.parentLotId === parentLotId && l.sector === sector) return l
    return undefined
  }

  private freeTruck(parentLotId: bigint, deliveredTo?: Address) {
    const t = this.truckOf.get(parentLotId.toString())
    if (!t) return
    t.busy = false
    const dest = deliveredTo ? this.persona(deliveredTo)?.place : undefined
    if (dest) t.at = dest
    this.truckOf.delete(parentLotId.toString())
  }

  private recordSplit(lot: LotInfo, buyer: Address, tokens: bigint) {
    const p = this.persona(buyer)
    const fam = p && FAMILIES[p.id]
    if (fam) this.splits.set(lot.lotId.toString(), poolSplit(tokens / UNIT, fam))
  }

  private at(at: bigint, what: string, run: () => Promise<void>) {
    this.tasks.push({ at, what, run })
  }
  private async intent(agentId: Address, action: Extract<TownEvent, { type: "agent.intent" }>["action"], lotId: bigint | undefined, reason: string, moveTo?: Building) {
    if (agentId === ZERO) return
    const block = Number(await this.o.chain.blockNumber())
    await this.o.publisher.publish([{ type: "agent.intent", agentId, action, ...(moveTo ? { moveTo } : {}), ...(lotId !== undefined ? { lotId: lotId.toString() } : {}), reason: reason.slice(0, 80) }], block)
  }
  private personas() {
    return this.o.personas ?? PERSONAS
  }
  private persona(a: Address) {
    const id = this.o.runtime.agents.get(lc(a))?.personaId
    return id ? this.personas().find((p) => p.id === id) : undefined
  }
  private addr(personaId: string): Address {
    for (const a of this.o.runtime.agents.values()) if (a.personaId === personaId) return a.agentId
    return ZERO
  }
  private isNoShowSeller(a: Address) {
    return this.persona(a)?.seeded?.noShow === true
  }
  private note(msg: string) {
    this.log.push(msg)
  }
  private fail(what: string, err: unknown) {
    const msg = `${what}: ${err instanceof Error ? err.message : String(err)}`
    this.log.push(msg)
    this.o.onError?.(what, err)
  }
}

function topHolder(lot: LotInfo): Address | undefined {
  let best: Address | undefined
  let max = 0n
  for (const [a, t] of lot.holders) if (t > max) [best, max] = [a, t]
  return best
}

const money = (v: bigint, cur: string) => `${cur === "EUR" ? "€" : "$"}${(v / 10_000n / 100n).toString()}.${(v / 10_000n % 100n).toString().padStart(2, "0")}`

function handoverReason(lot: LotInfo) {
  if (lot.sector === "truck") return `Delivered, releasing the truck's pay`
  if (lot.sector === "storage") return `Checked into the cold vault`
  return `Collected lot ${lot.lotId}, scanning the QR`
}
