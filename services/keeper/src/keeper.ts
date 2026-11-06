import { BaseError, getAbiItem, type Address, type PublicClient } from "viem"
import { continuousClearingAuctionAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import type { Deployment } from "@fairtown/shared/addresses"
import { bootstrapFromViews } from "./bootstrap"
import { viemReads, type Action, type PlanCtx, type Reads } from "./chain"
import { planCheckpoints } from "./checkpointer"
import { LOG_CHUNK, MIN_LOG_CHUNK } from "./config"
import { planCarriers, planNoShows, planReleases } from "./deadlines"
import { planExits } from "./exits"
import { shrinkLogChunk } from "./lib"
import { errText, type Logger } from "./log"
import { planSettles } from "./settler"
import { KeeperState } from "./state"
import type { TxQueue } from "./txQueue"

const BID_SUBMITTED = getAbiItem({ abi: continuousClearingAuctionAbi, name: "BidSubmitted" })

export type KeeperDeps = {
  pub: PublicClient
  queue: TxQueue
  dep: Deployment
  log: Logger
  checkpointEvery: bigint
  secrets: (string | undefined)[]
  reads?: Reads
}

/**
 * One keeper. `tick()` = read head, ingest new logs, plan every due action from state, run them through the queue.
 * Start-up rebuilds state from `deployedAtBlock` (D-55); there is no state file, the chain is the truth.
 */
export class Keeper {
  readonly state = new KeeperState()
  private readonly reads: Reads
  private readonly settlement: Address
  private reportWindowBlocks: bigint | undefined
  private chunk = LOG_CHUNK
  private booted = false

  constructor(private readonly d: KeeperDeps) {
    this.settlement = d.dep.contracts.MarketSettlement as Address
    this.reads = d.reads ?? viemReads(d.pub, this.settlement)
  }

  /** Ingest logs up to `head`, in chunks; on a range error the chunk drops to the RPC's stated limit, or halves. */
  async sync(head: bigint) {
    const core = [this.d.dep.contracts.LotFactory as Address, this.settlement]
    let from = this.state.cursor === 0n ? BigInt(this.d.dep.deployedAtBlock) : this.state.cursor + 1n
    let calls = 0
    while (from <= head) {
      if (++calls % 50 === 0) {
        this.d.log.info({ at: from.toString(), head: head.toString(), behind: (head - from).toString() }, "catching up")
      }
      const to = from + this.chunk - 1n < head ? from + this.chunk - 1n : head
      try {
        this.state.ingestCore(await this.d.pub.getLogs({ address: core, fromBlock: from, toBlock: to }))
        const auctions = this.state.auctionsLiveIn(from, to)
        if (auctions.length > 0) {
          this.state.ingestBids(
            await this.d.pub.getLogs({ address: auctions, event: BID_SUBMITTED, fromBlock: from, toBlock: to }),
          )
        }
        this.state.cursor = to
        from = to + 1n
      } catch (e) {
        const msg = e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : String(e)
        const next = shrinkLogChunk(msg, this.chunk, MIN_LOG_CHUNK)
        if (next !== undefined) {
          this.chunk = next
          this.d.log.warn({ chunk: this.chunk.toString() }, "getLogs range too large, shrinking")
          continue
        }
        throw e
      }
    }
  }

  private async reportWindow(): Promise<bigint> {
    this.reportWindowBlocks ??= BigInt(
      await this.d.pub.readContract({
        address: this.settlement,
        abi: marketSettlementAbi,
        functionName: "reportWindowBlocks",
      }),
    )
    return this.reportWindowBlocks
  }

  /** Cold start: rebuild state from contract views up to `head` (D-59), then tail logs from there. */
  async bootstrap(head: bigint) {
    await bootstrapFromViews(
      this.state,
      this.d.pub,
      this.d.dep,
      head,
      await this.reportWindow(),
      this.d.log,
      this.chunk,
    )
    this.state.cursor = head
    this.booted = true
  }

  async plan(head: bigint): Promise<Action[]> {
    const reportWindowBlocks = await this.reportWindow()
    const ctx: PlanCtx = {
      head,
      reads: this.reads,
      settlement: this.settlement,
      checkpointEvery: this.d.checkpointEvery,
      reportWindowBlocks,
    }
    // Order inside one batch: settle, then exits and claims, then deadlines, then checkpoints.
    return [
      ...planSettles(this.state, ctx),
      ...(await planExits(this.state, ctx)),
      ...planCarriers(this.state, ctx),
      ...planNoShows(this.state, ctx),
      ...planReleases(this.state, ctx),
      ...(await planCheckpoints(this.state, ctx)),
    ]
  }

  async tick(): Promise<{ head: bigint; sent: number }> {
    const head = await this.d.pub.getBlockNumber({ cacheTime: 0 })
    if (!this.booted) await this.bootstrap(head)
    else await this.sync(head)
    const { sent } = await this.d.queue.run(await this.plan(head))
    return { head, sent }
  }

  /** Ticks until a tick sends nothing (or `max` ticks). For tests and one-shot catch-up. */
  async runUntilIdle(max = 20): Promise<number> {
    let total = 0
    for (let i = 0; i < max; i++) {
      const { sent } = await this.tick()
      total += sent
      if (sent === 0) return total
    }
    return total
  }

  /**
   * The long-running loop. A failed tick is logged without secrets and retried on the next poll. A heartbeat every
   * `heartbeatMs` shows the keeper is alive while idle, and the first good tick after failures says so.
   */
  async loop(pollMs: number, signal: AbortSignal, heartbeatMs = 30_000, now: () => number = Date.now) {
    let failures = 0
    let lastBeat = now()
    while (!signal.aborted) {
      try {
        const { head, sent } = await this.tick()
        if (failures > 0) this.d.log.info({ head: head.toString(), failures }, "tick recovered")
        failures = 0
        if (sent > 0) this.d.log.info({ head: head.toString(), sent }, "tick")
        if (now() - lastBeat >= heartbeatMs) {
          lastBeat = now()
          this.d.log.info(
            {
              head: head.toString(),
              cursor: this.state.cursor.toString(),
              lots: this.state.lots.size,
              openReports: this.state.reports.size,
              ...this.d.queue.stats,
            },
            "alive",
          )
        }
      } catch (e) {
        failures++
        this.d.log.error({ err: errText(e, this.d.secrets), failures }, "tick failed")
      }
      if (!signal.aborted) await new Promise((r) => setTimeout(r, pollMs))
    }
  }
}
