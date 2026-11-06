import { Writable } from "node:stream"
import type { Address } from "viem"
import { ZERO, type BidView, type PlanCtx, type Reads, type ReportView, type SaleView } from "../src/chain"
import type { CheckpointView } from "../src/lib"
import { createLogger } from "../src/log"
import { KeeperState, type LotInfo } from "../src/state"

export const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address
export const SETTLEMENT = addr(0x5e771e)

export const sale = (o: Partial<SaleView> = {}): SaleView => ({
  settled: true,
  released: false,
  complete: false,
  sector: "fish",
  carrier: ZERO,
  parentLotId: 0n,
  soldTokens: 100n * 10n ** 18n,
  pickupDeadline: 1_000n,
  ...o,
})

/** In-memory chain for planners: every read comes from these maps, and counts are kept. */
export class FakeReads implements Reads {
  sales = new Map<bigint, SaleView>()
  reports = new Map<string, ReportView>()
  bids = new Map<string, BidView>()
  lastCp = new Map<Address, bigint>()
  clearing = new Map<Address, bigint>()
  cps = new Map<string, CheckpointView>()
  calls = 0
  async sale(lotId: bigint) {
    this.calls++
    return this.sales.get(lotId) ?? sale({ settled: false, soldTokens: 0n })
  }
  async report(lotId: bigint, buyer: Address) {
    this.calls++
    return this.reports.get(`${lotId}:${buyer}`) ?? { open: false, contested: false, contestEnds: 0n, tokens: 0n }
  }
  async bid(auction: Address, id: bigint) {
    this.calls++
    const b = this.bids.get(`${auction}:${id}`)
    if (!b) throw new Error(`no bid ${id}`)
    return b
  }
  async lastCheckpointed(auction: Address) {
    this.calls++
    return this.lastCp.get(auction) ?? 0n
  }
  async clearingPrice(auction: Address) {
    this.calls++
    return this.clearing.get(auction) ?? 0n
  }
  async checkpoint(auction: Address, block: bigint) {
    this.calls++
    const cp = this.cps.get(`${auction}:${block}`)
    if (!cp) throw new Error(`no checkpoint ${block}`)
    return cp
  }
}

export const ctx = (reads: Reads, head: bigint, o: Partial<PlanCtx> = {}): PlanCtx => ({
  head,
  reads,
  settlement: SETTLEMENT,
  checkpointEvery: 25n,
  reportWindowBlocks: 3_000n,
  ...o,
})

export function lot(state: KeeperState, o: Partial<LotInfo> & { lotId: bigint }): LotInfo {
  const info: LotInfo = {
    auction: addr(0xa000 + Number(o.lotId)),
    token: addr(0xb000 + Number(o.lotId)),
    seller: addr(0x5e11),
    sector: "fish",
    parentLotId: 0n,
    startBlock: 100n,
    endBlock: 550n,
    ...o,
  }
  state.lots.set(info.lotId, info)
  state.byAuction.set(info.auction, info.lotId)
  state.bids.set(info.lotId, state.bids.get(info.lotId) ?? new Map())
  return info
}

/** A logger whose output is captured as text, to assert on what reaches the log. */
export function captureLogger(secrets: (string | undefined)[] = []) {
  const lines: string[] = []
  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk))
      cb()
    },
  })
  const log = createLogger(secrets, dest, "debug")
  return { log, lines, text: () => lines.join("") }
}

export { KeeperState }
