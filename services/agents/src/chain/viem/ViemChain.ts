import {
  agentRegistryAbi,
  chainTriggerAbi,
  continuousClearingAuctionAbi,
  iAllowanceTransferAbi,
  lotFactoryAbi,
  lotTokenAbi,
  marketSettlementAbi,
  mockStableAbi,
  stubDisputeResolverAbi,
  stubSignalOracleAbi,
} from "@fairtown/shared/abi"
import type { Deployment } from "@fairtown/shared/addresses"
import { HANDOVER_TYPES, handoverDomain, type HandoverMessage, type HandoverTicket } from "@fairtown/shared/handover"
import { LOT_STATUS, ROLES, fromKey, toKey, type Currency, type Role, type Sector } from "@fairtown/shared"
import { Q96, UNIT, ceilToTick, toQ96 } from "@fairtown/shared/units"
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint160,
  maxUint256,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from "viem"
import { baseSepolia } from "viem/chains"
import { registerCurrency } from "../../arkiv/ledgerWriter"
import { ChainError } from "../errors"
import type { BidInput, ChainAdapter, ChainEvent, LotSpecInput, LotState, SellerRecord, SettlementView, Tx } from "../types"

const MAX_UINT48 = 281474976710655
const BID_GAS = 1_500_000n
const APPROVE_GAS = 120_000n // explicit gas skips eth_estimateGas, which flaps on load-balanced public RPCs
const LOG_CHUNK = 200n // public Base Sepolia RPC limits eth_getLogs to a 200-block range
const lc = (a: string) => a.toLowerCase() as Address

const EVENTS_ABI = [
  ...lotFactoryAbi,
  ...marketSettlementAbi,
  ...chainTriggerAbi,
  ...agentRegistryAbi,
  ...continuousClearingAuctionAbi,
  ...stubSignalOracleAbi,
  ...stubDisputeResolverAbi,
].filter((x) => x.type === "event") as Abi

export type ViemChainOptions = {
  deployment: Deployment
  rpcUrl: string
  logsRpcUrl?: string // Alchemy free tier caps eth_getLogs at ~10 blocks; default public Base Sepolia RPC
  operator: LocalAccount
  accountFor: (address: Address) => LocalAccount | undefined
  pollMs?: number
}

// Real contracts on Base Sepolia (or an anvil fork). Same interface and event shapes as FakeChain.
export class ViemChain implements ChainAdapter {
  readonly mode: "anvil" | "base-sepolia"
  readonly reader
  private readonly logs
  private readonly d: Deployment
  private readonly c: Deployment["contracts"]
  private readonly opts: ViemChainOptions
  private readonly currencyAddr: Record<Currency, Address>
  private readonly codeOf = new Map<string, Currency>()
  private readonly wallets = new Map<string, ReturnType<typeof createWalletClient>>()
  private readonly lotCache = new Map<string, { auction: Address; token: Address; tick: bigint; endBlock: bigint }>()
  private readonly settled = new Map<string, { finalClearingPerUnit: bigint; avgPerUnit: bigint; soldUnits: bigint; raised: bigint; sellerPaid: bigint; held: bigint; fee: bigint; advanceBps: number }>()
  private readonly auctions = new Set<string>()

  constructor(opts: ViemChainOptions) {
    this.opts = opts
    this.d = opts.deployment
    this.c = opts.deployment.contracts
    this.mode = opts.deployment.network === "anvil" ? "anvil" : "base-sepolia"
    this.reader = createPublicClient({ chain: baseSepolia, transport: http(opts.rpcUrl, { timeout: 30_000, retryCount: 5, retryDelay: 600 }), pollingInterval: 1_000 })
    this.logs = createPublicClient({ chain: baseSepolia, transport: http(opts.logsRpcUrl ?? "https://sepolia.base.org", { timeout: 30_000, retryCount: 5, retryDelay: 600 }) })
    this.currencyAddr = { USD: lc(this.c.TestUSD), EUR: lc(this.c.TestEUR), USDC: lc(this.d.external.CircleTestUSDC) }
    for (const [code, a] of Object.entries(this.currencyAddr)) {
      this.codeOf.set(a, code as Currency)
      registerCurrency(a, code)
    }
  }

  // ---------- reads ----------
  blockNumber() {
    return this.reader.getBlockNumber()
  }
  async balanceOf(asset: Currency | "ETH", owner: Address) {
    if (asset === "ETH") return this.reader.getBalance({ address: owner })
    return this.reader.readContract({ address: this.currencyAddr[asset], abi: mockStableAbi, functionName: "balanceOf", args: [owner] })
  }
  async tokenBalance(lotId: bigint, owner: Address) {
    const { token } = await this.cached(lotId)
    return this.reader.readContract({ address: token, abi: lotTokenAbi, functionName: "balanceOf", args: [owner] })
  }
  async clearingPerUnit(lotId: bigint) {
    const { auction } = await this.cached(lotId)
    const q = await this.reader.readContract({ address: auction, abi: continuousClearingAuctionAbi, functionName: "clearingPrice" })
    return ceilFromQ96(q)
  }
  async sellerRecord(seller: Address): Promise<SellerRecord> {
    const [cleanLots, noShows, proven] = await this.reader.readContract({
      address: this.c.MarketSettlement as Address,
      abi: marketSettlementAbi,
      functionName: "sellerRecord",
      args: [seller],
    })
    return { cleanLots: Number(cleanLots), noShows: Number(noShows), proven }
  }
  async advanceBpsFor(seller: Address, sector: Sector) {
    const bps = await this.reader.readContract({
      address: this.c.MarketSettlement as Address,
      abi: marketSettlementAbi,
      functionName: "advanceBpsFor",
      args: [seller, toKey(sector)],
    })
    return Number(bps)
  }

  async getLot(lotId: bigint): Promise<LotState> {
    const lot = await this.reader.readContract({ address: this.c.LotFactory as Address, abi: lotFactoryAbi, functionName: "getLot", args: [lotId] })
    if (lot.auction === "0x0000000000000000000000000000000000000000") throw new ChainError("LotNotFound", `Lot ${lotId} not found`)
    const s = lot.spec
    this.remember(lotId, lot.auction, lot.token, lot.tickSpacingQ96, lot.endBlock)
    const [statusIdx, clearingQ96, heldOf] = await Promise.all([
      this.reader.readContract({ address: this.c.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "statusOf", args: [lotId] }),
      this.reader.readContract({ address: lot.auction, abi: continuousClearingAuctionAbi, functionName: "clearingPrice" }),
      this.reader.readContract({ address: this.c.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "heldOf", args: [lotId] }),
    ])
    const [heldRemaining, soldTokens, pickupDeadline, carrier] = heldOf
    const spec: LotSpecInput = {
      sector: fromKey(s.sector) as Sector,
      market: fromKey(s.market) as LotSpecInput["market"],
      commodity: fromKey(s.commodity) as LotSpecInput["commodity"],
      grade: fromKey(s.grade) as LotSpecInput["grade"],
      place: fromKey(s.place) as LotSpecInput["place"],
      currency: this.codeOf.get(lc(s.currency)) ?? "USD",
      qty: s.qty,
      floorPerUnit: s.floorPerUnit,
      durationBlocks: s.durationBlocks,
      pickupWindowBlocks: s.pickupWindowBlocks,
      parentLotId: s.parentLotId,
      seller: lc(s.seller),
      metadataURI: s.metadataURI,
    }
    const state: LotState = {
      lotId,
      spec,
      auction: lc(lot.auction),
      token: lc(lot.token),
      startBlock: lot.startBlock,
      endBlock: lot.endBlock,
      floorQ96: lot.floorQ96,
      tickQ96: lot.tickSpacingQ96,
      status: LOT_STATUS[statusIdx] ?? "open",
      clearingPerUnit: ceilFromQ96(clearingQ96),
      bidCount: 0,
    }
    const ev = this.settled.get(lotId.toString()) ?? (await this.findSettled(lotId, lot.endBlock))
    if (ev) {
      const settlement: SettlementView = {
        ...ev,
        unsoldUnits: spec.qty > ev.soldUnits ? spec.qty - ev.soldUnits : 0n,
        soldTokens,
        heldRemaining,
        refunded: 0n,
        pickupDeadline,
        ...(carrier !== "0x0000000000000000000000000000000000000000" ? { carrier: lc(carrier) } : {}),
      }
      state.settlement = settlement
    }
    return state
  }

  // ---------- writes ----------
  async register(agent: Address, role: Role, name: string): Promise<Tx> {
    const reg = { address: this.c.AgentRegistry as Address, abi: agentRegistryAbi } as const
    const current = await this.reader.readContract({ ...reg, functionName: "roleOf", args: [agent] })
    if (current === ROLES[role]) return { tx: zeroTx() }
    const r = await this.send(this.opts.operator, {
      ...reg,
      functionName: current === 0 ? "register" : "setRole",
      args: current === 0 ? [agent, ROLES[role], name] : [agent, ROLES[role]],
    })
    return { tx: r.transactionHash }
  }
  async mint(currency: Currency, to: Address, amount: bigint): Promise<Tx> {
    if (currency === "USDC") throw new ChainError("NotImplemented", "Circle test USDC comes from the Circle faucet, not mint")
    const r = await this.send(this.opts.operator, { address: this.currencyAddr[currency], abi: mockStableAbi, functionName: "mint", args: [to, amount] })
    return { tx: r.transactionHash }
  }
  async sendEth(to: Address, wei: bigint): Promise<Tx> {
    const hash = await this.wallet(this.opts.operator).sendTransaction({ account: this.opts.operator, chain: baseSepolia, to, value: wei, ...(await this.fees()) })
    await this.receipt(hash, "sendEth")
    return { tx: hash }
  }
  async markProven(seller: Address, proven: boolean): Promise<Tx> {
    const r = await this.send(this.opts.operator, { address: this.c.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "markProven", args: [seller, proven] })
    return { tx: r.transactionHash }
  }

  // Permit2: one ERC-20 approval of Permit2 per token, then an allowance per auction.
  // Approvals are remembered once mined: public RPCs load-balance across nodes, and a lagging node can report a
  // fresh approval as missing, which made us re-send it.
  private readonly approved = new Set<string>()
  async ensurePermit2(owner: Address, currency: Currency, spender: Address): Promise<Tx | null> {
    const token = this.currencyAddr[currency]
    const permit2 = this.d.external.Permit2 as Address
    const account = this.account(owner)
    const erc20Key = `${lc(owner)}:${token}`
    const permitKey = `${erc20Key}:${lc(spender)}`
    if (this.approved.has(permitKey)) return null
    if (!this.approved.has(erc20Key)) {
      const erc20 = await this.reader.readContract({ address: token, abi: mockStableAbi, functionName: "allowance", args: [owner, permit2] })
      if (erc20 < maxUint256 / 2n) await this.send(account, { address: token, abi: mockStableAbi, functionName: "approve", args: [permit2, maxUint256], gas: APPROVE_GAS })
      this.approved.add(erc20Key)
    }
    const [amount, expiration] = await this.reader.readContract({ address: permit2, abi: iAllowanceTransferAbi, functionName: "allowance", args: [owner, token, spender] })
    if (amount > maxUint160 / 2n && expiration > Math.floor(Date.now() / 1000) + 3600) {
      this.approved.add(permitKey)
      return null
    }
    const r = await this.send(account, { address: permit2, abi: iAllowanceTransferAbi, functionName: "approve", args: [token, spender, maxUint160, MAX_UINT48], gas: APPROVE_GAS })
    this.approved.add(permitKey)
    return { tx: r.transactionHash }
  }

  async createLot(from: Address, spec: LotSpecInput) {
    const r = await this.send(this.account(from), {
      address: this.c.LotFactory as Address,
      abi: lotFactoryAbi,
      functionName: "createLot",
      args: [
        {
          sector: toKey(spec.sector),
          market: toKey(spec.market),
          commodity: toKey(spec.commodity),
          grade: toKey(spec.grade),
          place: toKey(spec.place),
          currency: this.currencyAddr[spec.currency],
          qty: spec.qty,
          floorPerUnit: spec.floorPerUnit,
          durationBlocks: spec.durationBlocks,
          pickupWindowBlocks: spec.pickupWindowBlocks,
          parentLotId: spec.parentLotId,
          seller: spec.seller,
          metadataURI: spec.metadataURI,
        },
      ],
    })
    const [ev] = parseEventLogs({ abi: lotFactoryAbi, logs: r.logs, eventName: "LotListed" })
    if (!ev) throw new ChainError("BadSpec", "createLot emitted no LotListed")
    const lot = await this.reader.readContract({ address: this.c.LotFactory as Address, abi: lotFactoryAbi, functionName: "getLot", args: [ev.args.lotId] })
    this.remember(ev.args.lotId, ev.args.auction, ev.args.token, lot.tickSpacingQ96, ev.args.endBlock)
    return { tx: r.transactionHash, lotId: ev.args.lotId, auction: lc(ev.args.auction), token: lc(ev.args.token) }
  }

  // The executor passes base units; the price goes on chain as Q96 rounded up to the auction tick (D-54).
  async submitBid(from: Address, bid: BidInput) {
    const { auction, tick } = await this.cached(bid.lotId)
    const priceQ96 = ceilToTick(toQ96(bid.maxPerUnit), tick)
    // Simulate first: a bid that would revert (outbid since we read clearing) fails here with its reason, at no gas cost.
    try {
      await this.reader.simulateContract({ account: from, address: auction, abi: continuousClearingAuctionAbi, functionName: "submitBid", args: [priceQ96, bid.amount, from, "0x"] })
    } catch (e) {
      throw new ChainError("BelowClearing", `submitBid would revert: ${safeMessage(e, this.opts.rpcUrl)}`)
    }
    const r = await this.send(this.account(from), {
      address: auction,
      abi: continuousClearingAuctionAbi,
      functionName: "submitBid",
      args: [priceQ96, bid.amount, from, "0x"],
      gas: BID_GAS,
    })
    const [ev] = parseEventLogs({ abi: continuousClearingAuctionAbi, logs: r.logs, eventName: "BidSubmitted" })
    if (!ev) throw new ChainError("BelowClearing", "submitBid emitted no BidSubmitted")
    return { tx: r.transactionHash, bidId: ev.args.id, priceQ96 }
  }

  async relist(from: Address, lotId: bigint, newFloorPerUnit: bigint, durationBlocks: bigint) {
    const r = await this.send(this.account(from), { address: this.c.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "relist", args: [lotId, newFloorPerUnit, durationBlocks] })
    const [ev] = parseEventLogs({ abi: marketSettlementAbi, logs: r.logs, eventName: "LotRelisted" })
    return { tx: r.transactionHash, newLotId: ev?.args.newLotId ?? 0n }
  }

  async signTicket(seller: Address, msg: HandoverMessage): Promise<HandoverTicket> {
    const account = this.account(seller)
    const sig = await account.signTypedData!({ domain: handoverDomain(baseSepolia.id, this.c.MarketSettlement as Address), types: HANDOVER_TYPES, primaryType: "Handover", message: msg })
    return { ...msg, sig }
  }
  async confirmHandover(from: Address, t: HandoverTicket) {
    const r = await this.send(this.account(from), {
      address: this.c.MarketSettlement as Address,
      abi: marketSettlementAbi,
      functionName: "confirmHandover",
      args: [t.lotId, t.buyer, t.tokenAmount, t.expiryBlock, t.sig],
    })
    const [ev] = parseEventLogs({ abi: marketSettlementAbi, logs: r.logs, eventName: "HandoverConfirmed" })
    return { tx: r.transactionHash, releasedToSeller: ev?.args.releasedToSeller ?? 0n }
  }
  async reportNoShow(from: Address, lotId: bigint, tokenAmount: bigint) {
    const r = await this.send(this.account(from), { address: this.c.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "reportNoShow", args: [lotId, tokenAmount] })
    const [ev] = parseEventLogs({ abi: marketSettlementAbi, logs: r.logs, eventName: "NoShowReported" })
    return { tx: r.transactionHash, contestEnds: ev?.args.contestEnds ?? 0n }
  }
  async contestNoShow(from: Address, lotId: bigint, buyer: Address, evidenceHash: Hex, evidenceURI: string) {
    const r = await this.send(this.account(from), { address: this.c.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "contestNoShow", args: [lotId, buyer, evidenceHash, evidenceURI] })
    const [ev] = parseEventLogs({ abi: marketSettlementAbi, logs: r.logs, eventName: "NoShowContested" })
    return { tx: r.transactionHash, disputeId: ev?.args.disputeId ?? 0n }
  }
  async openDispute(_from: Address, _lotId: bigint, _tokenAmount: bigint, _evidenceHash: Hex, _evidenceURI: string): Promise<Tx & { disputeId: bigint }> {
    // D-48: DisputeResolver is a reverting stub until S1 4.1.
    throw new ChainError("NotImplemented", "Disputes go live with S1 4.1 (DisputeResolver is a stub in v1)")
  }
  async requestStorage(from: Address, lotId: bigint, qty: bigint, days: number): Promise<Tx> {
    const r = await this.send(this.account(from), { address: this.c.ChainTrigger as Address, abi: chainTriggerAbi, functionName: "requestStorage", args: [lotId, qty, days] })
    return { tx: r.transactionHash }
  }

  // ---------- events ----------
  // HTTP log polling over every contract we deployed plus each auction we have seen. Works without a WebSocket.
  // onIdle(head): called each time the loop has processed every block up to head (backfill done, then every poll).
  watch(handler: (e: ChainEvent) => void, fromBlock?: bigint, onIdle?: (head: bigint) => void) {
    let stopped = false
    let next: bigint | undefined = fromBlock
    const loop = async () => {
      while (!stopped) {
        try {
          const head = await this.reader.getBlockNumber()
          let from: bigint = next ?? head + 1n
          while (!stopped && from <= head) {
            const to: bigint = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head
            const logs = await this.logs.getLogs({ address: this.addresses(), fromBlock: from, toBlock: to })
            const events = parseEventLogs({ abi: EVENTS_ABI, logs, strict: false }) as unknown as Array<ChainEvent & { removed?: boolean }>
            for (const e of events) {
              const ev = { eventName: e.eventName, args: e.args, address: lc(e.address), blockNumber: e.blockNumber, transactionHash: e.transactionHash, logIndex: e.logIndex } as ChainEvent
              this.observe(ev)
              handler(ev)
            }
            from = to + 1n
          }
          next = from
          if (!stopped) onIdle?.(head)
        } catch {
          // transient RPC failure: retry on the next poll
        }
        await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2_000))
      }
    }
    void loop()
    return () => {
      stopped = true
    }
  }

  // ---------- helpers ----------
  private observe(e: ChainEvent) {
    if (e.eventName === "LotListed") this.auctions.add(lc(e.args.auction))
    if (e.eventName === "LotSettled") {
      const a = e.args
      this.settled.set(a.lotId.toString(), { finalClearingPerUnit: a.finalClearingPerUnit, avgPerUnit: a.avgPerUnit, soldUnits: a.soldUnits, raised: a.raised, sellerPaid: a.sellerPaid, held: a.held, fee: a.fee, advanceBps: Number(a.advanceBps) })
    }
  }
  private addresses(): Address[] {
    return [this.c.LotFactory, this.c.MarketSettlement, this.c.ChainTrigger, this.c.AgentRegistry, this.c.SignalOracle, this.c.DisputeResolver, ...this.auctions].map((a) => lc(a))
  }
  private async findSettled(lotId: bigint, endBlock: bigint) {
    const head = await this.reader.getBlockNumber()
    if (head < endBlock) return undefined
    const to = endBlock + 20_000n < head ? endBlock + 20_000n : head
    for (let from = endBlock; from <= to; from += LOG_CHUNK) {
      const logs = await this.logs.getContractEvents({
        address: this.c.MarketSettlement as Address,
        abi: marketSettlementAbi,
        eventName: "LotSettled",
        args: { lotId },
        fromBlock: from,
        toBlock: from + LOG_CHUNK - 1n < to ? from + LOG_CHUNK - 1n : to,
      })
      const a = logs[0]?.args
      if (a) {
        const v = { finalClearingPerUnit: a.finalClearingPerUnit!, avgPerUnit: a.avgPerUnit!, soldUnits: a.soldUnits!, raised: a.raised!, sellerPaid: a.sellerPaid!, held: a.held!, fee: a.fee!, advanceBps: Number(a.advanceBps!) }
        this.settled.set(lotId.toString(), v)
        return v
      }
    }
    return undefined
  }
  private remember(lotId: bigint, auction: Address, token: Address, tick: bigint, endBlock: bigint) {
    this.lotCache.set(lotId.toString(), { auction: lc(auction), token: lc(token), tick, endBlock })
    this.auctions.add(lc(auction))
  }
  private async cached(lotId: bigint) {
    const hit = this.lotCache.get(lotId.toString())
    if (hit) return hit
    await this.getLot(lotId)
    return this.lotCache.get(lotId.toString())!
  }
  private account(address: Address) {
    const a = lc(address) === lc(this.opts.operator.address) ? this.opts.operator : this.opts.accountFor(lc(address))
    if (!a) throw new ChainError("NoSigner", `No key for ${address}`)
    return a
  }
  private wallet(account: LocalAccount) {
    let w = this.wallets.get(account.address)
    if (!w) {
      w = createWalletClient({ account, chain: baseSepolia, transport: http(this.opts.rpcUrl, { timeout: 30_000, retryCount: 5, retryDelay: 600 }) })
      this.wallets.set(account.address, w)
    }
    return w
  }
  private async send(account: LocalAccount, req: Record<string, unknown>, attempt = 0): Promise<TransactionReceipt> {
    try {
      const hash = await this.wallet(account).writeContract({ ...(req as object), ...(await this.fees()), account, chain: baseSepolia } as never)
      return await this.receipt(hash, String(req.functionName))
    } catch (e) {
      if (e instanceof ChainError) throw e
      const msg = safeMessage(e, this.opts.rpcUrl)
      // Transient errors from load-balanced RPC nodes (stale balance or nonce): one retry before giving up.
      if (attempt === 0 && /gas required exceeds|nonce too low|already known|HTTP request failed|underpriced/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1_500))
        return this.send(account, req, 1)
      }
      throw new ChainError("BadSpec", `${String(req.functionName)}: ${msg}`)
    }
  }
  // Base Sepolia's base fee moves between estimate and inclusion; a 2x cap avoids "fee cap below base fee".
  private feeCache?: { at: number; v: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } }
  private async fees() {
    if (this.feeCache && Date.now() - this.feeCache.at < 4_000) return this.feeCache.v
    const f = await this.reader.estimateFeesPerGas()
    const v = { maxFeePerGas: f.maxFeePerGas * 2n, maxPriorityFeePerGas: f.maxPriorityFeePerGas }
    this.feeCache = { at: Date.now(), v }
    return v
  }
  private async receipt(hash: Hex, label: string) {
    const r = await this.reader.waitForTransactionReceipt({ hash, timeout: 60_000 })
    if (r.status !== "success") throw new ChainError("BadSpec", `${label} reverted (${hash})`)
    return r
  }
}

// Round clearing up when converting from Q96, so "a tick above clearing" is never computed from a low value.
const ceilFromQ96 = (q: bigint) => (q * UNIT + Q96 - 1n) / Q96
const zeroTx = () => `0x${"0".repeat(64)}` as Hex

// viem errors include the RPC URL (which can carry a provider key). Keep the revert reason, drop the URL.
export function safeMessage(e: unknown, rpcUrl?: string) {
  // Prefer the decoded custom error name (e.g. BidMustBeAboveClearingPrice) over viem's generic text.
  const walk = (x: unknown): string | undefined => {
    const o = x as { data?: { errorName?: string; args?: unknown[] }; cause?: unknown } | undefined
    if (!o) return undefined
    if (o.data?.errorName) return `${o.data.errorName}${o.data.args?.length ? `(${o.data.args.map(String).join(", ")})` : ""}`
    return walk(o.cause)
  }
  const named = walk(e)
  if (named) return named
  let msg = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)
  if (rpcUrl) msg = msg.split(rpcUrl).join("<rpc>")
  return msg.replace(/https?:\/\/\S+/g, "<rpc>").replace(/wss?:\/\/\S+/g, "<rpc>").slice(0, 300)
}
