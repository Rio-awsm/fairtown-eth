import {
  HANDOVER_TYPES,
  ROLES,
  UNIT,
  ceilToTick,
  floorToTick,
  handoverDomain,
  splitPayout,
  tickFor,
  toKey,
  toQ96,
  type Currency,
  type HandoverMessage,
  type HandoverTicket,
  type LotStatus,
  type Role,
  type Sector,
} from "@fairtown/shared"
import { keccak256, recoverTypedDataAddress, toHex, type Address, type Hex, type LocalAccount } from "viem"
import { ChainError } from "../errors"
import type {
  BidInput,
  ChainAdapter,
  ChainEvent,
  ChainEventName,
  EventArgs,
  LotSpecInput,
  LotState,
  ProtocolParams,
  SellerRecord,
  SettlementView,
  SignalInput,
  Tx,
} from "../types"
import { computeClearing } from "./clearing"

const lc = (a: string): Address => a.toLowerCase() as Address
export const fakeAddress = (tag: number, n: bigint): Address =>
  `0x${tag.toString(16).padStart(2, "0")}${n.toString(16).padStart(38, "0")}`

const LISTERS: readonly Role[] = ["SELLER", "TRUCK", "STORAGE"]
const BIDDERS: readonly Role[] = ["BUYER", "SOCIETY", "HUMAN"]
const CHAINED: readonly Sector[] = ["produce", "fish", "flowers"]
const MIN_PER_UNIT = 1_000n
const ZERO32 = `0x${"0".repeat(64)}` as Hex

export const FAKE = {
  settlement: fakeAddress(0x5e, 1n),
  registry: fakeAddress(0x5e, 2n),
  factory: fakeAddress(0x5e, 3n),
  trigger: fakeAddress(0x5e, 4n),
  oracle: fakeAddress(0x5e, 5n),
  resolver: fakeAddress(0x5e, 6n),
  treasury: fakeAddress(0x7e, 1n),
} as const

type Bid = { id: bigint; owner: Address; maxPerUnit: bigint; priceQ96: bigint; amount: bigint }
type Settlement = SettlementView & { resolvedTokens: bigint }
type Lot = Omit<LotState, "settlement" | "bidCount"> & { bids: Bid[]; settlement?: Settlement; relistedTo?: bigint }
type Report = { lotId: bigint; buyer: Address; tokenAmount: bigint; contestEnds: bigint; state: "open" | "contested" | "done" }
type Dispute = { id: bigint; lotId: bigint; buyer: Address; tokenAmount: bigint; kind: 0 | 1 }

export type FakeChainOptions = {
  params: ProtocolParams
  chainId?: number
  treasury?: Address
  accountFor?: (address: Address) => LocalAccount | undefined
}

export class FakeChain implements ChainAdapter {
  readonly mode = "fake" as const
  readonly currencies: Record<Currency, Address> = {
    USD: fakeAddress(0xc0, 1n),
    EUR: fakeAddress(0xc0, 2n),
    USDC: fakeAddress(0xc0, 3n),
  }
  readonly treasury: Address
  readonly log: ChainEvent[] = []
  private readonly params: ProtocolParams
  private readonly domain: ReturnType<typeof handoverDomain>
  private readonly accountFor: (address: Address) => LocalAccount | undefined
  private block = 1n
  private logIndex = 0
  private txCount = 0n
  private nextLotId = 1n
  private nextBidId = 1n
  private nextDisputeId = 1n
  private nextSignalId = 1n
  private readonly roles = new Map<Address, Role>()
  private readonly balances = new Map<string, bigint>()
  private readonly tokens = new Map<string, bigint>()
  private readonly permits = new Set<string>()
  private readonly lots = new Map<bigint, Lot>()
  private readonly records = new Map<Address, { cleanLots: number; noShows: number; marked: boolean }>()
  private readonly reports = new Map<string, Report>()
  private readonly disputes = new Map<bigint, Dispute>()
  private readonly usedTickets = new Set<string>()
  private readonly handlers = new Set<(e: ChainEvent) => void>()

  constructor(opts: FakeChainOptions) {
    this.params = opts.params
    this.treasury = lc(opts.treasury ?? FAKE.treasury)
    this.domain = handoverDomain(opts.chainId ?? 84532, FAKE.settlement)
    this.accountFor = opts.accountFor ?? (() => undefined)
  }

  // ---------- clock ----------
  async blockNumber() {
    return this.block
  }
  get currentBlock() {
    return this.block
  }
  mine(n = 1) {
    for (let i = 0; i < n; i++) {
      this.block++
      this.logIndex = 0
      this.keeper()
    }
  }
  autoMine(ms: number): () => void {
    const t = setInterval(() => this.mine(), ms)
    t.unref?.()
    return () => clearInterval(t)
  }
  watch(handler: (e: ChainEvent) => void) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  // ---------- registry and money ----------
  async register(agent: Address, role: Role, name: string): Promise<Tx> {
    const tx = this.tx()
    this.roles.set(lc(agent), role)
    this.emit("AgentRegistered", { agent: lc(agent), role: ROLES[role], name }, FAKE.registry, tx)
    return { tx }
  }
  async mint(currency: Currency, to: Address, amount: bigint): Promise<Tx> {
    this.credit(currency, to, amount)
    return { tx: this.tx() }
  }
  async sendEth(to: Address, wei: bigint): Promise<Tx> {
    this.credit("ETH", to, wei)
    return { tx: this.tx() }
  }
  async balanceOf(asset: Currency | "ETH", owner: Address) {
    return this.bal(asset, owner)
  }
  async tokenBalance(lotId: bigint, owner: Address) {
    return this.tokens.get(`${lotId}:${lc(owner)}`) ?? 0n
  }
  totalOf(asset: Currency): bigint {
    let sum = 0n
    for (const [k, v] of this.balances) if (k.startsWith(`${asset}:`)) sum += v
    return sum
  }
  async ensurePermit2(owner: Address, currency: Currency, spender: Address): Promise<Tx | null> {
    const key = `${lc(owner)}:${currency}:${lc(spender)}`
    if (this.permits.has(key)) return null
    this.permits.add(key)
    return { tx: this.tx() }
  }

  // ---------- lots and bids ----------
  async createLot(from: Address, spec: LotSpecInput) {
    const role = this.roles.get(lc(from))
    if (!role || !LISTERS.includes(role)) throw new ChainError("CannotList", `${from} cannot list`)
    if (lc(spec.seller) !== lc(from)) throw new ChainError("NotSeller")
    if (spec.floorPerUnit < MIN_PER_UNIT) throw new ChainError("FloorTooLow")
    if (spec.qty <= 0n || spec.durationBlocks <= 0n) throw new ChainError("BadSpec")
    const tx = this.tx()
    const lot = this.openLot(spec, tx)
    return { tx, lotId: lot.lotId, auction: lot.auction, token: lot.token }
  }

  async submitBid(from: Address, bid: BidInput) {
    const lot = this.lotOf(bid.lotId)
    if (lot.status !== "open" || this.block >= lot.endBlock) throw new ChainError("AuctionEnded")
    const role = this.roles.get(lc(from))
    if (!role || !BIDDERS.includes(role)) throw new ChainError("CannotBid", `${from} cannot bid`)
    if (bid.amount <= 0n) throw new ChainError("BadAmount")
    if (bid.maxPerUnit <= lot.clearingPerUnit) throw new ChainError("BelowClearing")
    const cur = lot.spec.currency
    if (!this.permits.has(`${lc(from)}:${cur}:${lc(lot.auction)}`)) throw new ChainError("NoPermit2")
    if (this.bal(cur, from) < bid.amount) throw new ChainError("InsufficientBalance")
    const tx = this.tx()
    this.move(cur, from, lot.auction, bid.amount)
    const priceQ96 = ceilToTick(toQ96(bid.maxPerUnit), lot.tickQ96)
    const id = this.nextBidId++
    lot.bids.push({ id, owner: lc(from), maxPerUnit: bid.maxPerUnit, priceQ96, amount: bid.amount })
    this.emit("BidSubmitted", { id, owner: lc(from), priceQ96, amount: bid.amount }, lot.auction, tx)
    const next = computeClearing(lot.bids, lot.spec.qty, lot.spec.floorPerUnit).clearingPerUnit
    if (next !== lot.clearingPerUnit) {
      lot.clearingPerUnit = next
      this.emit("ClearingPriceUpdated", { blockNumber: this.block, clearingPriceQ96: toQ96(next) }, lot.auction, tx)
    }
    return { tx, bidId: id, priceQ96 }
  }

  async getLot(lotId: bigint): Promise<LotState> {
    const l = this.lotOf(lotId)
    const view: LotState = {
      lotId: l.lotId,
      spec: { ...l.spec },
      auction: l.auction,
      token: l.token,
      startBlock: l.startBlock,
      endBlock: l.endBlock,
      floorQ96: l.floorQ96,
      tickQ96: l.tickQ96,
      status: l.status,
      clearingPerUnit: l.clearingPerUnit,
      bidCount: l.bids.length,
    }
    if (l.settlement) {
      const s: SettlementView & { resolvedTokens?: bigint } = { ...l.settlement }
      delete s.resolvedTokens
      view.settlement = s
    }
    return view
  }
  async clearingPerUnit(lotId: bigint) {
    return this.lotOf(lotId).clearingPerUnit
  }

  async relist(from: Address, lotId: bigint, newFloorPerUnit: bigint, durationBlocks: bigint) {
    const lot = this.lotOf(lotId)
    const s = lot.settlement
    if (!s) throw new ChainError("AuctionOpen")
    if (lc(from) !== lc(lot.spec.seller)) throw new ChainError("NotSeller")
    if (s.unsoldUnits === 0n || lot.relistedTo !== undefined) throw new ChainError("NothingToRelist")
    if (newFloorPerUnit >= lot.spec.floorPerUnit) throw new ChainError("FloorNotLower")
    if (newFloorPerUnit < MIN_PER_UNIT) throw new ChainError("FloorTooLow")
    const tx = this.tx()
    const child = this.openLot(
      { ...lot.spec, qty: s.unsoldUnits, floorPerUnit: newFloorPerUnit, durationBlocks, parentLotId: lot.lotId },
      tx,
    )
    lot.relistedTo = child.lotId
    if (lot.status === "unsold") lot.status = "relisted"
    this.emit("LotRelisted", { lotId, newLotId: child.lotId, newFloorPerUnit }, FAKE.settlement, tx)
    return { tx, newLotId: child.lotId }
  }

  // ---------- seller record ----------
  async sellerRecord(seller: Address): Promise<SellerRecord> {
    const r = this.record(seller)
    return { cleanLots: r.cleanLots, noShows: r.noShows, proven: this.isProven(seller) }
  }
  async advanceBpsFor(seller: Address, sector: Sector) {
    return this.advanceFor(seller, sector)
  }
  markProven(seller: Address, proven: boolean) {
    this.record(seller).marked = proven
    this.emitRecord(seller, this.tx())
  }

  // ---------- handover ----------
  async signTicket(seller: Address, msg: HandoverMessage): Promise<HandoverTicket> {
    const account = this.accountFor(lc(seller))
    if (!account) throw new ChainError("NoSigner", `No key for ${seller}`)
    const sig = await account.signTypedData({ domain: this.domain, types: HANDOVER_TYPES, primaryType: "Handover", message: msg })
    return { ...msg, sig }
  }

  async confirmHandover(from: Address, t: HandoverTicket) {
    const lot = this.lotOf(t.lotId)
    const s = this.settled(lot)
    if (t.expiryBlock < this.block) throw new ChainError("TicketExpired")
    const used = t.sig.toLowerCase()
    if (this.usedTickets.has(used)) throw new ChainError("TicketUsed")
    let signer: Address
    try {
      signer = await recoverTypedDataAddress({
        domain: this.domain,
        types: HANDOVER_TYPES,
        primaryType: "Handover",
        message: { lotId: t.lotId, buyer: t.buyer, tokenAmount: t.tokenAmount, expiryBlock: t.expiryBlock },
        signature: t.sig,
      })
    } catch {
      throw new ChainError("BadSignature")
    }
    if (lc(signer) !== lc(lot.spec.seller)) throw new ChainError("BadSignature")
    const sender = lc(from)
    if (sender !== lc(t.buyer) && sender !== s.carrier) throw new ChainError("NotBuyerOrCarrier")
    if (t.tokenAmount === 0n || (await this.tokenBalance(lot.lotId, t.buyer)) < t.tokenAmount)
      throw new ChainError("InsufficientTokens")
    if (s.heldRemaining === 0n) throw new ChainError("NotHeld")

    const tx = this.tx()
    this.usedTickets.add(used)
    this.burnTokens(lot.lotId, t.buyer, t.tokenAmount)
    const released = this.shareOf(s, t.tokenAmount)
    this.payFromHeld(lot, s, lot.spec.seller, released, t.tokenAmount)
    this.emit(
      "HandoverConfirmed",
      { lotId: lot.lotId, buyer: lc(t.buyer), receiver: sender, tokenAmount: t.tokenAmount, releasedToSeller: released },
      FAKE.settlement,
      tx,
    )

    const parent = lot.spec.sector === "truck" && lot.spec.parentLotId > 0n ? this.lots.get(lot.spec.parentLotId) : undefined
    if (s.carrier !== undefined && sender === s.carrier) {
      this.advance(lot, "picked_up")
    } else if (parent && parent.settlement?.truckLotId === lot.lotId) {
      this.emit("LotDelivered", { lotId: parent.lotId, truckLotId: lot.lotId }, FAKE.settlement, tx)
      this.advance(parent, "delivered")
      this.advance(lot, "delivered")
    } else {
      this.emit("LotDelivered", { lotId: lot.lotId, truckLotId: 0n }, FAKE.settlement, tx)
      this.advance(lot, "delivered")
    }
    if (s.heldRemaining === 0n) this.drained(lot, tx)
    return { tx, releasedToSeller: released }
  }

  // ---------- no-show and disputes ----------
  async reportNoShow(from: Address, lotId: bigint, tokenAmount: bigint) {
    const lot = this.lotOf(lotId)
    const s = this.settled(lot)
    if (this.block <= s.pickupDeadline) throw new ChainError("TooEarly")
    if (this.block > s.pickupDeadline + this.params.reportWindowBlocks) throw new ChainError("WindowClosed")
    if (s.heldRemaining === 0n) throw new ChainError("NotHeld")
    const key = `${lotId}:${lc(from)}`
    if (this.reports.has(key)) throw new ChainError("AlreadyReported")
    if (tokenAmount === 0n || (await this.tokenBalance(lotId, from)) < tokenAmount) throw new ChainError("InsufficientTokens")
    const tx = this.tx()
    this.burnTokens(lotId, from, tokenAmount)
    const contestEnds = this.block + this.params.contestWindowBlocks
    this.reports.set(key, { lotId, buyer: lc(from), tokenAmount, contestEnds, state: "open" })
    lot.status = "no_show_reported"
    this.emit("NoShowReported", { lotId, buyer: lc(from), tokenAmount, contestEnds }, FAKE.settlement, tx)
    return { tx, contestEnds }
  }

  async contestNoShow(from: Address, lotId: bigint, buyer: Address, evidenceHash: Hex, evidenceURI: string) {
    const lot = this.lotOf(lotId)
    const r = this.reports.get(`${lotId}:${lc(buyer)}`)
    if (!r) throw new ChainError("NoReport")
    if (lc(from) !== lc(lot.spec.seller)) throw new ChainError("NotSeller")
    if (r.state !== "open") throw new ChainError("AlreadyContested")
    if (this.block > r.contestEnds) throw new ChainError("WindowClosed")
    const tx = this.tx()
    r.state = "contested"
    const disputeId = this.nextDisputeId++
    this.disputes.set(disputeId, { id: disputeId, lotId, buyer: r.buyer, tokenAmount: r.tokenAmount, kind: 1 })
    lot.status = "disputed"
    this.emit(
      "DisputeOpened",
      { disputeId, lotId, buyer: r.buyer, kind: 1, tokenAmount: r.tokenAmount, evidenceHash, evidenceURI },
      FAKE.resolver,
      tx,
    )
    this.emit("NoShowContested", { lotId, buyer: r.buyer, disputeId }, FAKE.settlement, tx)
    return { tx, disputeId }
  }

  async openDispute(from: Address, lotId: bigint, tokenAmount: bigint, evidenceHash: Hex, evidenceURI: string) {
    const lot = this.lotOf(lotId)
    const s = this.settled(lot)
    if (this.block > s.pickupDeadline + this.params.reportWindowBlocks) throw new ChainError("WindowClosed")
    if (s.heldRemaining === 0n) throw new ChainError("NotHeld")
    if (tokenAmount === 0n || (await this.tokenBalance(lotId, from)) < tokenAmount) throw new ChainError("InsufficientTokens")
    const tx = this.tx()
    this.burnTokens(lotId, from, tokenAmount)
    const disputeId = this.nextDisputeId++
    this.disputes.set(disputeId, { id: disputeId, lotId, buyer: lc(from), tokenAmount, kind: 0 })
    lot.status = "disputed"
    this.emit(
      "DisputeOpened",
      { disputeId, lotId, buyer: lc(from), kind: 0, tokenAmount, evidenceHash, evidenceURI },
      FAKE.resolver,
      tx,
    )
    return { tx, disputeId }
  }

  // Stand-in for CRE W3 calling DisputeResolver.onReport.
  resolveRuling(disputeId: bigint, refundBps: number) {
    const d = this.disputes.get(disputeId)
    if (!d) throw new ChainError("DisputeNotFound")
    const lot = this.lotOf(d.lotId)
    const s = this.settled(lot)
    const tx = this.tx()
    const share = this.shareOf(s, d.tokenAmount)
    const refund = (share * BigInt(refundBps)) / 10000n
    const paid = share - refund
    this.payFromHeld(lot, s, d.buyer, refund, 0n)
    this.payFromHeld(lot, s, lot.spec.seller, paid, d.tokenAmount)
    s.refunded += refund
    this.disputes.delete(disputeId)
    const report = this.reports.get(`${d.lotId}:${d.buyer}`)
    if (report) report.state = "done"
    this.emit("RulingSettled", { lotId: d.lotId, buyer: d.buyer, refundToBuyer: refund, paidToSeller: paid }, FAKE.settlement, tx)
    this.emit("DisputeResolved", { disputeId, lotId: d.lotId, refundBps, reasonHash: ZERO32 }, FAKE.resolver, tx)
    if (d.kind === 1 && refundBps === 10000) this.penalize(lot.spec.seller, tx)
    if (refund > 0n) lot.status = "refunded"
    else if (s.heldRemaining === 0n) this.drained(lot, tx)
    else lot.status = "sold"
  }

  async requestStorage(from: Address, lotId: bigint, qty: bigint, days: number): Promise<Tx> {
    this.lotOf(lotId)
    if (qty <= 0n || (await this.tokenBalance(lotId, from)) < qty * UNIT) throw new ChainError("InsufficientTokens")
    const tx = this.tx()
    this.emit("StorageNeeded", { lotId, requester: lc(from), qty, days_: days }, FAKE.trigger, tx)
    return { tx }
  }

  // ---------- oracle stand-ins ----------
  pushSignal(s: SignalInput) {
    const id = this.nextSignalId++
    this.emit(
      "DemandSignal",
      { id, signalKind: toKey(s.kind), place: toKey(s.place), severity: s.severity, expiresAtBlock: s.expiresAtBlock, label: s.label },
      FAKE.oracle,
      this.tx(),
    )
  }
  pushReference(commodity: string, market: string, perUnit: bigint, currency: Currency, source: string) {
    this.emit(
      "ReferencePriceUpdated",
      {
        commodity: toKey(commodity),
        market: toKey(market),
        perUnit,
        currencyCode: toKey(currency),
        sourceTag: toKey(source),
        updatedAt: this.block,
      },
      FAKE.oracle,
      this.tx(),
    )
  }
  pushFx(currency: string, perUsdE8: bigint) {
    this.emit("FxUpdated", { currencyCode: toKey(currency), perUsdE8, updatedAt: this.block }, FAKE.oracle, this.tx())
  }

  // ---------- keeper ----------
  private keeper() {
    for (const lot of this.lots.values()) if (lot.status === "open" && this.block >= lot.endBlock) this.settle(lot)
    for (const r of this.reports.values()) if (r.state === "open" && this.block > r.contestEnds) this.finalizeNoShow(r)
    for (const lot of this.lots.values()) this.maybeReleaseExpired(lot)
  }

  private settle(lot: Lot) {
    const tx = this.tx()
    const { clearingPerUnit, fills } = computeClearing(lot.bids, lot.spec.qty, lot.spec.floorPerUnit)
    const cur = lot.spec.currency
    let raised = 0n
    let sold = 0n
    for (const b of lot.bids) {
      const f = fills.find((x) => x.id === b.id)
      const units = f?.units ?? 0n
      const paid = f?.paid ?? 0n
      raised += paid
      sold += units
      this.move(cur, lot.auction, b.owner, b.amount - paid)
      if (units > 0n) this.tokens.set(`${lot.lotId}:${b.owner}`, (this.tokens.get(`${lot.lotId}:${b.owner}`) ?? 0n) + units * UNIT)
      this.emit("BidExited", { bidId: b.id, owner: b.owner, tokensFilled: units * UNIT, currencyRefunded: b.amount - paid }, lot.auction, tx)
      if (units > 0n) this.emit("TokensClaimed", { bidId: b.id, owner: b.owner, tokensFilled: units * UNIT }, lot.auction, tx)
    }
    const advanceBps = this.advanceFor(lot.spec.seller, lot.spec.sector)
    const { fee, advance, held } = splitPayout(raised, this.params.feeBps, BigInt(advanceBps))
    this.move(cur, lot.auction, this.treasury, fee)
    this.move(cur, lot.auction, lot.spec.seller, advance)
    this.move(cur, lot.auction, FAKE.settlement, held)
    const pickupDeadline = lot.endBlock + lot.spec.pickupWindowBlocks
    const avgPerUnit = sold > 0n ? raised / sold : 0n
    lot.settlement = {
      finalClearingPerUnit: sold > 0n ? clearingPerUnit : 0n,
      avgPerUnit,
      soldUnits: sold,
      unsoldUnits: lot.spec.qty - sold,
      soldTokens: sold * UNIT,
      raised,
      sellerPaid: advance,
      held,
      heldRemaining: held,
      fee,
      refunded: 0n,
      advanceBps,
      pickupDeadline,
      resolvedTokens: 0n,
    }
    lot.status = sold > 0n ? "sold" : "unsold"
    this.emit(
      "LotSettled",
      {
        lotId: lot.lotId,
        finalClearingPerUnit: lot.settlement.finalClearingPerUnit,
        avgPerUnit,
        soldUnits: sold,
        raised,
        sellerPaid: advance,
        held,
        fee,
        advanceBps,
        pickupDeadline,
      },
      FAKE.settlement,
      tx,
    )
    if (sold === 0n) return
    if (CHAINED.includes(lot.spec.sector)) {
      this.emit(
        "TransportNeeded",
        { lotId: lot.lotId, fromMarket: toKey(lot.spec.market), place: toKey(lot.spec.place), qty: sold, readyByBlock: pickupDeadline },
        FAKE.trigger,
        tx,
      )
    }
    if (lot.spec.sector === "truck" && lot.spec.parentLotId > 0n) this.assignCarrier(lot, tx)
  }

  private assignCarrier(truck: Lot, tx: Hex) {
    const parent = this.lots.get(truck.spec.parentLotId)
    const ps = parent?.settlement
    if (!parent || !ps || ps.soldUnits === 0n || ps.carrier !== undefined) return
    ps.carrier = lc(truck.spec.seller)
    ps.truckLotId = truck.lotId
    this.advance(parent, "truck_booked")
    this.emit("CarrierAssigned", { lotId: parent.lotId, truckLotId: truck.lotId, carrier: ps.carrier }, FAKE.settlement, tx)
  }

  private finalizeNoShow(r: Report) {
    const lot = this.lotOf(r.lotId)
    const s = this.settled(lot)
    const tx = this.tx()
    const refund = this.shareOf(s, r.tokenAmount)
    this.payFromHeld(lot, s, r.buyer, refund, r.tokenAmount)
    s.refunded += refund
    r.state = "done"
    lot.status = "refunded"
    this.emit("NoShowRefunded", { lotId: r.lotId, seller: lc(lot.spec.seller), buyer: r.buyer, refund }, FAKE.settlement, tx)
    this.penalize(lot.spec.seller, tx)
  }

  private maybeReleaseExpired(lot: Lot) {
    const s = lot.settlement
    if (!s || s.heldRemaining === 0n) return
    if (this.block <= s.pickupDeadline + this.params.reportWindowBlocks) return
    for (const r of this.reports.values()) if (r.lotId === lot.lotId && r.state !== "done") return
    for (const d of this.disputes.values()) if (d.lotId === lot.lotId) return
    const tx = this.tx()
    const amount = s.heldRemaining
    this.payFromHeld(lot, s, lot.spec.seller, amount, s.soldTokens - s.resolvedTokens)
    this.emit("HeldReleased", { lotId: lot.lotId, amount }, FAKE.settlement, tx)
    this.drained(lot, tx)
  }

  // A lot's held money is fully released.
  private drained(lot: Lot, tx: Hex) {
    const s = lot.settlement!
    if (s.refunded === 0n) {
      this.record(lot.spec.seller).cleanLots++
      this.emitRecord(lot.spec.seller, tx)
    }
    if (s.carrier !== undefined) {
      const truck = this.lots.get(s.truckLotId!)
      if (truck?.settlement?.heldRemaining === 0n) this.paidInFull(lot, tx)
      return
    }
    this.paidInFull(lot, tx)
    if (lot.spec.sector === "truck" && lot.spec.parentLotId > 0n) {
      const parent = this.lots.get(lot.spec.parentLotId)
      if (parent?.settlement?.truckLotId === lot.lotId && parent.settlement.heldRemaining === 0n) this.paidInFull(parent, tx)
    }
  }

  private paidInFull(lot: Lot, tx: Hex) {
    if (lot.status === "paid_in_full") return
    lot.status = "paid_in_full"
    this.emit("LotPaidInFull", { lotId: lot.lotId }, FAKE.settlement, tx)
  }

  private penalize(seller: Address, tx: Hex) {
    const r = this.record(seller)
    r.noShows++
    r.cleanLots = 0
    r.marked = false
    this.emitRecord(seller, tx)
  }

  // ---------- helpers ----------
  private openLot(spec: LotSpecInput, tx: Hex): Lot {
    const lotId = this.nextLotId++
    const raw = toQ96(spec.floorPerUnit)
    const tickQ96 = tickFor(raw)
    const lot: Lot = {
      lotId,
      spec: { ...spec, seller: lc(spec.seller) },
      auction: fakeAddress(0xa1, lotId),
      token: fakeAddress(0x70, lotId),
      startBlock: this.block,
      endBlock: this.block + spec.durationBlocks,
      floorQ96: floorToTick(raw, tickQ96),
      tickQ96,
      status: "open",
      clearingPerUnit: spec.floorPerUnit,
      bids: [],
    }
    this.lots.set(lotId, lot)
    this.emit(
      "LotListed",
      {
        lotId,
        seller: lot.spec.seller,
        market: toKey(spec.market),
        auction: lot.auction,
        token: lot.token,
        currency: this.currencies[spec.currency],
        sector: toKey(spec.sector),
        commodity: toKey(spec.commodity),
        place: toKey(spec.place),
        qty: spec.qty,
        floorPerUnit: spec.floorPerUnit,
        startBlock: lot.startBlock,
        endBlock: lot.endBlock,
        parentLotId: spec.parentLotId,
        metadataURI: spec.metadataURI,
      },
      FAKE.factory,
      tx,
    )
    return lot
  }

  private shareOf(s: Settlement, tokenAmount: bigint) {
    return s.resolvedTokens + tokenAmount >= s.soldTokens ? s.heldRemaining : (s.held * tokenAmount) / s.soldTokens
  }
  private payFromHeld(lot: Lot, s: Settlement, to: Address, amount: bigint, tokensResolved: bigint) {
    this.move(lot.spec.currency, FAKE.settlement, to, amount)
    s.heldRemaining -= amount
    s.resolvedTokens += tokensResolved
  }
  private advance(lot: Lot, to: LotStatus) {
    const order: LotStatus[] = ["sold", "truck_booked", "picked_up", "delivered", "paid_in_full"]
    const cur = order.indexOf(lot.status)
    if (order.indexOf(to) > cur) lot.status = to
  }
  private advanceFor(seller: Address, sector: Sector) {
    if (sector === "truck") return this.params.advanceTruckBps
    return this.isProven(seller) ? this.params.advanceProvenBps : this.params.advanceNewBps
  }
  private isProven(seller: Address) {
    const r = this.record(seller)
    return r.marked || r.cleanLots >= this.params.provenAfter
  }
  private record(seller: Address) {
    const key = lc(seller)
    let r = this.records.get(key)
    if (!r) {
      r = { cleanLots: 0, noShows: 0, marked: false }
      this.records.set(key, r)
    }
    return r
  }
  private emitRecord(seller: Address, tx: Hex) {
    const r = this.record(seller)
    this.emit(
      "SellerRecordUpdated",
      { seller: lc(seller), cleanLots: r.cleanLots, noShows: r.noShows, proven: this.isProven(seller) },
      FAKE.settlement,
      tx,
    )
  }
  private lotOf(lotId: bigint) {
    const lot = this.lots.get(lotId)
    if (!lot) throw new ChainError("LotNotFound", `Lot ${lotId} not found`)
    return lot
  }
  private settled(lot: Lot): Settlement {
    if (!lot.settlement) throw new ChainError("AuctionOpen")
    return lot.settlement
  }
  private burnTokens(lotId: bigint, owner: Address, amount: bigint) {
    const key = `${lotId}:${lc(owner)}`
    this.tokens.set(key, (this.tokens.get(key) ?? 0n) - amount)
  }
  private bal(asset: string, owner: Address) {
    return this.balances.get(`${asset}:${lc(owner)}`) ?? 0n
  }
  private credit(asset: string, to: Address, amount: bigint) {
    const key = `${asset}:${lc(to)}`
    this.balances.set(key, (this.balances.get(key) ?? 0n) + amount)
  }
  private move(asset: string, from: Address, to: Address, amount: bigint) {
    if (amount === 0n) return
    const have = this.bal(asset, from)
    if (have < amount) throw new Error(`FakeChain accounting: ${from} has ${have} ${asset}, needs ${amount}`)
    this.balances.set(`${asset}:${lc(from)}`, have - amount)
    this.credit(asset, to, amount)
  }
  private tx(): Hex {
    return keccak256(toHex(`fake-tx-${++this.txCount}`))
  }
  private emit<N extends ChainEventName>(eventName: N, args: EventArgs<N>, address: Address, tx: Hex) {
    const e = { eventName, args, address, blockNumber: this.block, transactionHash: tx, logIndex: this.logIndex++ } as Extract<
      ChainEvent,
      { eventName: N }
    >
    this.log.push(e)
    for (const h of this.handlers) h(e)
  }
}
