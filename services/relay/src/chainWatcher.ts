import {
  agentRegistryAbi,
  chainTriggerAbi,
  continuousClearingAuctionAbi,
  lotFactoryAbi,
  marketSettlementAbi,
  disputeResolverAbi,
  signalOracleAbi,
} from "@fairtown/shared/abi"
import type { Deployment } from "@fairtown/shared/addresses"
import { fromKey, type TownEnvelope } from "@fairtown/shared"
import { createPublicClient, http, parseEventLogs, webSocket, type Abi, type Address, type Hex } from "viem"
import { baseSepolia } from "viem/chains"
import { ChainMapper, type RawChainEvent } from "./mapping"

const EVENTS_ABI = [
  ...lotFactoryAbi,
  ...marketSettlementAbi,
  ...chainTriggerAbi,
  ...agentRegistryAbi,
  ...continuousClearingAuctionAbi,
  ...signalOracleAbi,
  ...disputeResolverAbi,
].filter((x) => x.type === "event") as Abi

const CHUNK = 200n // public Base Sepolia RPC limits eth_getLogs to a 200-block range
const CLOCK_EVERY = 25n // ~5 s at Base's ~200 ms blocks
const ceilFromQ96 = (q: bigint) => (q * 10n ** 18n + 2n ** 96n - 1n) / 2n ** 96n

export type ChainWatcherOptions = {
  deployment: Deployment
  rpcUrl: string
  wsUrl?: string
  // Alchemy's free tier caps eth_getLogs at ~10 blocks; logs come from a separate endpoint (default: public Base Sepolia RPC).
  logsRpcUrl?: string
  publish: (envs: TownEnvelope[]) => void
  nameOf: (address: string) => string | undefined
  backfillBlocks?: bigint
  fromBlock?: bigint
  tickMs?: number
  onError?: (where: string, e: unknown) => void
}

// Contract logs to town events: new heads over WebSocket (or polling), logs over HTTP from the last processed block,
// so a dropped socket resumes without gaps. Plus a clearing-price ticker and a block clock.
export class ChainWatcher {
  readonly mapper: ChainMapper
  readonly reader
  private readonly logs
  private readonly heads
  private readonly o: ChainWatcherOptions
  private next?: bigint
  private lastClock = 0n
  private running = false
  private busy = false
  private stops: Array<() => void> = []
  head = 0n

  constructor(o: ChainWatcherOptions) {
    this.o = o
    this.reader = createPublicClient({ chain: baseSepolia, transport: http(o.rpcUrl, { timeout: 30_000, retryCount: 5, retryDelay: 600 }) })
    this.logs = createPublicClient({ chain: baseSepolia, transport: http(o.logsRpcUrl ?? "https://sepolia.base.org", { timeout: 30_000, retryCount: 5, retryDelay: 600 }) })
    this.heads = o.wsUrl
      ? createPublicClient({ chain: baseSepolia, transport: webSocket(o.wsUrl, { reconnect: { attempts: 1_000, delay: 1_000 }, keepAlive: { interval: 15_000 } }) })
      : this.reader
    const currencies = new Map<string, string>([
      [o.deployment.contracts.TestUSD.toLowerCase(), "USD"],
      [o.deployment.contracts.TestEUR.toLowerCase(), "EUR"],
      [o.deployment.external.CircleTestUSDC.toLowerCase(), "USDC"],
    ])
    this.mapper = new ChainMapper({
      currencyOf: (a) => currencies.get(a) ?? a,
      nameOf: o.nameOf,
      gradeOf: async (lotId) => {
        const lot = await this.reader.readContract({ address: o.deployment.contracts.LotFactory as Address, abi: lotFactoryAbi, functionName: "getLot", args: [lotId] })
        return fromKey(lot.spec.grade as Hex)
      },
    })
  }

  async start() {
    this.running = true
    const head = await this.reader.getBlockNumber()
    this.head = head
    const floor = BigInt(this.o.deployment.deployedAtBlock)
    const back = this.o.fromBlock ?? (head > (this.o.backfillBlocks ?? 20_000n) ? head - (this.o.backfillBlocks ?? 20_000n) : 0n)
    this.next = back > floor ? back : floor
    await this.catchUp()
    const unwatch = this.heads.watchBlockNumber({
      emitOnBegin: false,
      ...(this.o.wsUrl ? {} : { poll: true as const, pollingInterval: 1_000 }),
      onBlockNumber: (b) => {
        this.head = b
        void this.catchUp()
      },
      onError: (e) => this.o.onError?.("heads", e),
    })
    const t = setInterval(() => void this.tickPrices(), this.o.tickMs ?? 2_000)
    t.unref?.()
    this.stops.push(unwatch, () => clearInterval(t))
  }

  stop() {
    this.running = false
    for (const s of this.stops.splice(0)) s()
  }

  // Process every log from `next` to the current head, in order.
  async catchUp() {
    if (this.busy || !this.running || this.next === undefined) return
    this.busy = true
    try {
      const head: bigint = this.head > 0n ? this.head : await this.reader.getBlockNumber()
      let from: bigint = this.next
      while (this.running && from <= head) {
        const to: bigint = from + CHUNK - 1n < head ? from + CHUNK - 1n : head
        const logs = await this.logs.getLogs({ address: this.addresses(), fromBlock: from, toBlock: to })
        const fresh: Array<{ auction: Address; block: bigint }> = []
        const settled: bigint[] = []
        await this.apply(parseEventLogs({ abi: EVENTS_ABI, logs, strict: false }) as unknown as RawChainEvent[], fresh, settled)
        // Auctions listed inside this chunk were not in the address set yet: fetch their logs for the rest of it.
        if (fresh.length) {
          const first = fresh.reduce((m, f) => (f.block < m ? f.block : m), to)
          const more = await this.logs.getLogs({ address: fresh.map((f) => f.auction), fromBlock: first, toBlock: to })
          await this.apply(parseEventLogs({ abi: EVENTS_ABI, logs: more, strict: false }) as unknown as RawChainEvent[], [], settled)
        }
        for (const id of settled) this.mapper.forget(id)
        from = to + 1n
        this.next = from
      }
      if (head - this.lastClock >= CLOCK_EVERY) {
        this.lastClock = head
        this.o.publish([{ v: 1, id: `clock-${head}`, ts: Date.now(), block: Number(head), source: "chain", event: { type: "clock", block: Number(head) } }])
      }
    } catch (e) {
      this.o.onError?.("logs", e)
    } finally {
      this.busy = false
    }
  }

  private async apply(events: RawChainEvent[], fresh: Array<{ auction: Address; block: bigint }>, settled: bigint[]) {
    for (const e of events) {
      const envs = await this.mapper.map(e)
      if (envs.length) this.o.publish(envs)
      if (e.eventName === "LotListed") fresh.push({ auction: String(e.args.auction).toLowerCase() as Address, block: BigInt(String(e.blockNumber)) })
      if (e.eventName === "LotSettled") settled.push(BigInt(String(e.args.lotId)))
    }
  }

  async tickPrices() {
    for (const lot of this.mapper.openAuctions()) {
      try {
        const q = await this.reader.readContract({ address: lot.auction as Address, abi: continuousClearingAuctionAbi, functionName: "clearingPrice" })
        const env = this.mapper.tick(lot.lotId, ceilFromQ96(q), Number(this.head))
        if (env) this.o.publish([env])
      } catch (e) {
        this.o.onError?.("ticker", e)
      }
    }
  }

  private addresses(): Address[] {
    const c = this.o.deployment.contracts
    return [c.LotFactory, c.MarketSettlement, c.ChainTrigger, c.SignalOracle, c.DisputeResolver, ...this.mapper.openAuctions().map((l) => l.auction)].map(
      (a) => a.toLowerCase() as Address,
    )
  }
}
