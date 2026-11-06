import {
  BaseError,
  ContractFunctionRevertedError,
  NonceTooLowError,
  TransactionReceiptNotFoundError,
  encodeFunctionData,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem"
import type { Action } from "./chain"
import { errText, type Logger } from "./log"

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
export type Receipt = { status: "success" | "reverted"; blockNumber: bigint }
type Call = Action["call"]

/** The keeper's own key, and nothing else. Tests swap in a fake. */
export interface Sender {
  address: Address
  estimateGas(call: Call): Promise<bigint> // throws on revert, with the decoded error
  fees(): Promise<Fees>
  pendingNonce(): Promise<number>
  send(tx: { call: Call; nonce: number; gas: bigint; fees: Fees }): Promise<Hash>
  receipt(hash: Hash): Promise<Receipt | null>
}

/** Reverts meaning someone already did it: the action is done. */
export const DONE_ERRORS = new Set([
  "AlreadySettled",
  "BidAlreadyExited",
  "CarrierAlreadyAssigned",
  "HeldAlreadyReleased",
  "NoOpenReport",
  "LotClosed",
])
/** Reverts that can never succeed for this action: stop trying. */
export const NEVER_ERRORS = new Set(["ParentMismatch", "NotATruckLot", "NotSold", "TruckNotSold", "Contested"])

export function revertName(e: unknown): string | undefined {
  if (!(e instanceof BaseError)) return undefined
  const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
  return rev?.data?.errorName
}
const isNonceError = (e: unknown) =>
  e instanceof BaseError
    ? !!e.walk((x) => x instanceof NonceTooLowError) || /nonce too low|already known|replacement/i.test(e.message)
    : false

export type QueueOptions = {
  pollMs?: number
  stuckMs?: number // rebroadcast with higher fees after this long unmined
  maxBumps?: number
  timeoutMs?: number // give up on a tx (it may still land; the next tick re-checks)
  bumpPct?: bigint // replacement fee, percent of the old one (geth needs >= 110)
  gasBufferPct?: bigint
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}
export type QueueStats = {
  sent: number
  mined: number
  reverted: number
  skipped: number
  failed: number
  bumped: number
}

type InFlight = {
  action: Action
  nonce: number
  gas: bigint
  fees: Fees
  hashes: Hash[]
  lastSent: number
  bumps: number
}

/**
 * Nonce-safe sender for keeper actions. Per run: skip done keys and keys in backoff, re-check `stillNeeded`,
 * estimate gas (a revert is classified, never sent), send independent actions back to back with consecutive nonces,
 * then wait for all receipts, replacing stuck ones at the same nonce with higher fees. A nonce is only consumed when
 * a send succeeds, so a failed send leaves no gap. Any doubt resyncs the nonce from the chain.
 */
export class TxQueue {
  readonly done = new Set<string>()
  readonly stats: QueueStats = { sent: 0, mined: 0, reverted: 0, skipped: 0, failed: 0, bumped: 0 }
  private readonly backoff = new Map<string, { untilRun: number; attempts: number }>()
  private nonce: number | undefined
  private runNo = 0
  private readonly o: Required<QueueOptions>

  constructor(
    private readonly sender: Sender,
    private readonly log: Logger,
    private readonly secrets: (string | undefined)[],
    opts: QueueOptions = {},
  ) {
    this.o = {
      pollMs: 500,
      stuckMs: 10_000,
      maxBumps: 3,
      timeoutMs: 90_000,
      bumpPct: 115n,
      gasBufferPct: 125n,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...opts,
    }
  }

  /** Runs one batch to completion. Returns how many transactions were sent. */
  async run(actions: Action[]): Promise<{ sent: number }> {
    this.runNo++
    const seen = new Set<string>()
    const flying: InFlight[] = []
    for (const a of actions) {
      if (seen.has(a.key) || this.done.has(a.key)) continue
      seen.add(a.key)
      const b = this.backoff.get(a.key)
      if (b && this.runNo < b.untilRun) continue
      const f = await this.prepareAndSend(a)
      if (f) flying.push(f)
    }
    await this.awaitAll(flying)
    return { sent: flying.length }
  }

  private async prepareAndSend(a: Action): Promise<InFlight | undefined> {
    try {
      if (!(await a.stillNeeded())) {
        if (a.once) this.done.add(a.key)
        this.stats.skipped++
        return undefined
      }
    } catch (e) {
      this.retryLater(a, "read failed, retrying next tick", e, true)
      return undefined
    }
    let gas: bigint
    try {
      gas = ((await this.sender.estimateGas(a.call)) * this.o.gasBufferPct) / 100n
    } catch (e) {
      const name = revertName(e)
      if (name && DONE_ERRORS.has(name)) {
        this.done.add(a.key)
        this.stats.skipped++
        this.log.info({ action: a.label, reason: name }, "already done")
      } else if (name && NEVER_ERRORS.has(name)) {
        this.done.add(a.key)
        this.stats.failed++
        this.log.warn({ action: a.label, reason: name }, "can never succeed, dropped")
      } else this.retryLater(a, "would revert", e)
      return undefined
    }
    try {
      const nonce = this.nonce ?? (await this.sender.pendingNonce())
      const fees = await this.sender.fees()
      const hash = await this.sender.send({ call: a.call, nonce, gas, fees })
      this.nonce = nonce + 1
      this.stats.sent++
      this.log.info({ action: a.label, nonce, hash }, "sent")
      return { action: a, nonce, gas, fees, hashes: [hash], lastSent: this.o.now(), bumps: 0 }
    } catch (e) {
      this.nonce = undefined // resync next time
      this.retryLater(a, isNonceError(e) ? "nonce conflict, resyncing" : "send failed", e)
      return undefined
    }
  }

  private async awaitAll(flying: InFlight[]) {
    const started = this.o.now()
    let open = [...flying]
    while (open.length > 0) {
      const still: InFlight[] = []
      for (const f of open) {
        const r = await this.findReceipt(f)
        if (r) this.finish(f, r)
        else if (this.o.now() - started > this.o.timeoutMs) {
          this.nonce = undefined
          this.stats.failed++
          this.retryLater(f.action, "not mined before timeout, resyncing nonce", undefined)
        } else {
          if (this.o.now() - f.lastSent > this.o.stuckMs && f.bumps < this.o.maxBumps) await this.bump(f)
          still.push(f)
        }
      }
      open = still
      if (open.length > 0) await this.o.sleep(this.o.pollMs)
    }
  }

  private async findReceipt(f: InFlight): Promise<Receipt | null> {
    for (const h of f.hashes) {
      try {
        const r = await this.sender.receipt(h)
        if (r) return r
      } catch (e) {
        this.log.warn({ action: f.action.label, err: errText(e, this.secrets) }, "receipt read failed")
      }
    }
    return null
  }

  /** Same nonce, same call, fees raised by bumpPct (or to the current estimate, if higher). */
  private async bump(f: InFlight) {
    try {
      const now = await this.sender.fees()
      const up = (old: bigint, cur: bigint) => {
        const b = (old * this.o.bumpPct) / 100n + 1n
        return cur > b ? cur : b
      }
      const fees = {
        maxFeePerGas: up(f.fees.maxFeePerGas, now.maxFeePerGas),
        maxPriorityFeePerGas: up(f.fees.maxPriorityFeePerGas, now.maxPriorityFeePerGas),
      }
      const hash = await this.sender.send({ call: f.action.call, nonce: f.nonce, gas: f.gas, fees })
      f.hashes.push(hash)
      f.fees = fees
      this.stats.bumped++
      this.log.warn(
        { action: f.action.label, nonce: f.nonce, hash, bump: f.bumps + 1 },
        "stuck, replaced with higher fees",
      )
    } catch (e) {
      // "nonce too low" here means an earlier hash was mined; the receipt check picks it up.
      if (!isNonceError(e))
        this.log.warn({ action: f.action.label, err: errText(e, this.secrets) }, "replacement failed")
    }
    f.bumps++
    f.lastSent = this.o.now()
  }

  private finish(f: InFlight, r: Receipt) {
    const hash = f.hashes.at(-1)
    if (r.status === "success") {
      this.stats.mined++
      if (f.action.once) this.done.add(f.action.key)
      this.backoff.delete(f.action.key)
      this.log.info({ action: f.action.label, block: r.blockNumber.toString() }, "mined")
    } else {
      this.stats.reverted++
      this.retryLater(f.action, `reverted onchain (${hash})`, undefined)
    }
  }

  /** Exponential backoff (2 to 64 runs) for reverts and send failures; a transient read failure retries next run. */
  private retryLater(a: Action, why: string, e: unknown, transient = false) {
    const prev = this.backoff.get(a.key)?.attempts ?? 0
    const attempts = prev + 1
    const wait = transient ? 1 : Math.min(2 ** attempts, 64)
    this.backoff.set(a.key, { untilRun: this.runNo + wait, attempts: transient ? prev : attempts })
    this.log.warn({ action: a.label, attempts, err: e === undefined ? undefined : errText(e, this.secrets) }, why)
  }
}

/** Sender backed by viem, signing with the keeper's local account only. */
export function viemSender(pub: PublicClient, wallet: WalletClient<Transport, Chain, Account>): Sender {
  const account = wallet.account
  return {
    address: account.address,
    estimateGas: (c) =>
      pub.estimateContractGas({ ...c, account } as Parameters<PublicClient["estimateContractGas"]>[0]),
    fees: async () => {
      const f = await pub.estimateFeesPerGas()
      return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas }
    },
    pendingNonce: () => pub.getTransactionCount({ address: account.address, blockTag: "pending" }),
    send: ({ call, nonce, gas, fees }) =>
      wallet.sendTransaction({
        account,
        chain: wallet.chain,
        to: call.address,
        data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
        nonce,
        gas,
        ...fees,
      }),
    receipt: async (hash) => {
      try {
        const r = await pub.getTransactionReceipt({ hash })
        return { status: r.status, blockNumber: r.blockNumber }
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null
        throw e
      }
    },
  }
}
