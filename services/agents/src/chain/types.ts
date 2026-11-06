import type {
  Building,
  Commodity,
  Currency,
  Grade,
  HandoverMessage,
  HandoverTicket,
  LotStatus,
  Place,
  Role,
  Sector,
  SignalKind,
} from "@fairtown/shared"
import type { Address, Hex } from "viem"

export type ProtocolParams = {
  feeBps: bigint
  advanceNewBps: number
  advanceProvenBps: number
  advanceTruckBps: number
  provenAfter: number
  contestWindowBlocks: bigint
  reportWindowBlocks: bigint
}

export type LotSpecInput = {
  sector: Sector
  market: Building
  commodity: Commodity
  grade: Grade
  place: Place
  currency: Currency
  qty: bigint
  floorPerUnit: bigint
  durationBlocks: bigint
  pickupWindowBlocks: bigint
  parentLotId: bigint
  seller: Address
  metadataURI: string
}

export type SettlementView = {
  finalClearingPerUnit: bigint
  avgPerUnit: bigint
  soldUnits: bigint
  unsoldUnits: bigint
  soldTokens: bigint
  raised: bigint
  sellerPaid: bigint
  held: bigint
  heldRemaining: bigint
  fee: bigint
  refunded: bigint
  advanceBps: number
  pickupDeadline: bigint
  carrier?: Address
  truckLotId?: bigint
}

export type LotState = {
  lotId: bigint
  spec: LotSpecInput
  auction: Address
  token: Address
  startBlock: bigint
  endBlock: bigint
  floorQ96: bigint
  tickQ96: bigint
  status: LotStatus
  clearingPerUnit: bigint
  bidCount: number
  settlement?: SettlementView
}

export type SellerRecord = { cleanLots: number; noShows: number; proven: boolean }

type Log<N extends string, A> = {
  eventName: N
  args: A
  address: Address
  blockNumber: bigint
  transactionHash: Hex
  logIndex: number
}

export type ChainEvent =
  | Log<"AgentRegistered", { agent: Address; role: number; name: string }>
  | Log<
      "LotListed",
      {
        lotId: bigint
        seller: Address
        market: Hex
        auction: Address
        token: Address
        currency: Address
        sector: Hex
        commodity: Hex
        place: Hex
        qty: bigint
        floorPerUnit: bigint
        startBlock: bigint
        endBlock: bigint
        parentLotId: bigint
        metadataURI: string
      }
    >
  | Log<"BidSubmitted", { id: bigint; owner: Address; priceQ96: bigint; amount: bigint }>
  | Log<"ClearingPriceUpdated", { blockNumber: bigint; clearingPriceQ96: bigint }>
  | Log<"BidExited", { bidId: bigint; owner: Address; tokensFilled: bigint; currencyRefunded: bigint }>
  | Log<"TokensClaimed", { bidId: bigint; owner: Address; tokensFilled: bigint }>
  | Log<
      "LotSettled",
      {
        lotId: bigint
        finalClearingPerUnit: bigint
        avgPerUnit: bigint
        soldUnits: bigint
        raised: bigint
        sellerPaid: bigint
        held: bigint
        fee: bigint
        advanceBps: number
        pickupDeadline: bigint
      }
    >
  | Log<"LotRelisted", { lotId: bigint; newLotId: bigint; newFloorPerUnit: bigint }>
  | Log<"CarrierAssigned", { lotId: bigint; truckLotId: bigint; carrier: Address }>
  | Log<
      "HandoverConfirmed",
      { lotId: bigint; buyer: Address; receiver: Address; tokenAmount: bigint; releasedToSeller: bigint }
    >
  | Log<"LotPaidInFull", { lotId: bigint }>
  | Log<"LotDelivered", { lotId: bigint; truckLotId: bigint }>
  | Log<"NoShowReported", { lotId: bigint; buyer: Address; tokenAmount: bigint; contestEnds: bigint }>
  | Log<"NoShowContested", { lotId: bigint; buyer: Address; disputeId: bigint }>
  | Log<"NoShowRefunded", { lotId: bigint; seller: Address; buyer: Address; refund: bigint }>
  | Log<"HeldReleased", { lotId: bigint; amount: bigint }>
  | Log<"RulingSettled", { lotId: bigint; buyer: Address; refundToBuyer: bigint; paidToSeller: bigint }>
  | Log<"SellerRecordUpdated", { seller: Address; cleanLots: number; noShows: number; proven: boolean }>
  | Log<"TransportNeeded", { lotId: bigint; fromMarket: Hex; place: Hex; qty: bigint; readyByBlock: bigint }>
  | Log<"StorageNeeded", { lotId: bigint; requester: Address; qty: bigint; days_: number }>
  | Log<
      "ReferencePriceUpdated",
      { commodity: Hex; market: Hex; perUnit: bigint; currencyCode: Hex; sourceTag: Hex; updatedAt: bigint }
    >
  | Log<"FxUpdated", { currencyCode: Hex; perUsdE8: bigint; updatedAt: bigint }>
  | Log<
      "DemandSignal",
      { id: bigint; signalKind: Hex; place: Hex; severity: number; expiresAtBlock: bigint; label: string }
    >
  | Log<
      "DisputeOpened",
      {
        disputeId: bigint
        lotId: bigint
        buyer: Address
        kind: number
        tokenAmount: bigint
        evidenceHash: Hex
        evidenceURI: string
      }
    >
  | Log<"DisputeResolved", { disputeId: bigint; lotId: bigint; refundBps: number; reasonHash: Hex }>

export type ChainEventName = ChainEvent["eventName"]
export type EventArgs<N extends ChainEventName> = Extract<ChainEvent, { eventName: N }>["args"]

export type Tx = { tx: Hex }
export type BidInput = { lotId: bigint; maxPerUnit: bigint; amount: bigint }
export type SignalInput = { kind: SignalKind; place: Place; severity: number; expiresAtBlock: bigint; label: string }

export interface ChainAdapter {
  readonly mode: "fake" | "anvil" | "base-sepolia"
  blockNumber(): Promise<bigint>
  register(agent: Address, role: Role, name: string): Promise<Tx>
  mint(currency: Currency, to: Address, amount: bigint): Promise<Tx>
  sendEth(to: Address, wei: bigint): Promise<Tx>
  balanceOf(asset: Currency | "ETH", owner: Address): Promise<bigint>
  tokenBalance(lotId: bigint, owner: Address): Promise<bigint>
  ensurePermit2(owner: Address, currency: Currency, spender: Address): Promise<Tx | null>
  createLot(from: Address, spec: LotSpecInput): Promise<Tx & { lotId: bigint; auction: Address; token: Address }>
  submitBid(from: Address, bid: BidInput): Promise<Tx & { bidId: bigint; priceQ96: bigint }>
  getLot(lotId: bigint): Promise<LotState>
  clearingPerUnit(lotId: bigint): Promise<bigint>
  relist(from: Address, lotId: bigint, newFloorPerUnit: bigint, durationBlocks: bigint): Promise<Tx & { newLotId: bigint }>
  signTicket(seller: Address, msg: HandoverMessage): Promise<HandoverTicket>
  confirmHandover(from: Address, ticket: HandoverTicket): Promise<Tx & { releasedToSeller: bigint }>
  reportNoShow(from: Address, lotId: bigint, tokenAmount: bigint): Promise<Tx & { contestEnds: bigint }>
  contestNoShow(
    from: Address,
    lotId: bigint,
    buyer: Address,
    evidenceHash: Hex,
    evidenceURI: string,
  ): Promise<Tx & { disputeId: bigint }>
  openDispute(
    from: Address,
    lotId: bigint,
    tokenAmount: bigint,
    evidenceHash: Hex,
    evidenceURI: string,
  ): Promise<Tx & { disputeId: bigint }>
  requestStorage(from: Address, lotId: bigint, qty: bigint, days: number): Promise<Tx>
  sellerRecord(seller: Address): Promise<SellerRecord>
  advanceBpsFor(seller: Address, sector: Sector): Promise<number>
  watch(handler: (e: ChainEvent) => void): () => void
}
