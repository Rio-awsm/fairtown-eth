import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  NonceTooLowError,
  type Hash,
} from "viem"
import { describe, expect, it } from "vitest"
import { marketSettlementAbi } from "@fairtown/shared/abi"
import type { Action } from "../src/chain"
import { TxQueue, revertName, type Fees, type Receipt, type Sender } from "../src/txQueue"
import { SETTLEMENT, addr, captureLogger } from "./fakes"

const SECRET_URL = "https://rpc.example/v2/SECRET_RPC_KEY_123"

function revert(errorName: string) {
  const abi = marketSettlementAbi
  const cause = new ContractFunctionRevertedError({ abi, functionName: "settle", message: errorName })
  ;(cause as unknown as { data: { errorName: string } }).data = { errorName }
  return new ContractFunctionExecutionError(cause, { abi, functionName: "settle", args: [1n] })
}

type Sent = { nonce: number; gas: bigint; fees: Fees; label: string; hash: Hash }

/** Scriptable sender: mines immediately unless told otherwise. */
class FakeSender implements Sender {
  address = addr(0xcee)
  chainNonce = 7
  sent: Sent[] = []
  estimate: (label: string) => bigint | Error = () => 100_000n
  sendError: (label: string, nonce: number) => Error | undefined = () => undefined
  mineAfterPolls = 0
  status: (label: string) => Receipt["status"] = () => "success"
  private polls = new Map<Hash, number>()
  feeNow: Fees = { maxFeePerGas: 1_000n, maxPriorityFeePerGas: 100n }

  async estimateGas(call: Action["call"]) {
    const r = this.estimate(String(call.args[0]))
    if (r instanceof Error) throw r
    return r
  }
  async fees() {
    return this.feeNow
  }
  async pendingNonce() {
    return this.chainNonce
  }
  async send(tx: { call: Action["call"]; nonce: number; gas: bigint; fees: Fees }) {
    const label = String(tx.call.args[0])
    const err = this.sendError(label, tx.nonce)
    if (err) throw err
    const hash = `0x${(this.sent.length + 1).toString(16).padStart(64, "0")}` as Hash
    this.sent.push({ nonce: tx.nonce, gas: tx.gas, fees: tx.fees, label, hash })
    return hash
  }
  async receipt(hash: Hash): Promise<Receipt | null> {
    const n = (this.polls.get(hash) ?? 0) + 1
    this.polls.set(hash, n)
    if (n <= this.mineAfterPolls) return null
    const s = this.sent.find((x) => x.hash === hash)!
    return { status: this.status(s.label), blockNumber: 1n }
  }
}

const act = (id: number, o: Partial<Action> = {}): Action => ({
  key: `settle:${id}`,
  label: `settle lot ${id}`,
  once: true,
  call: { address: SETTLEMENT, abi: marketSettlementAbi, functionName: "settle", args: [BigInt(id)] },
  stillNeeded: async () => true,
  ...o,
})

function setup(opts = {}) {
  const s = new FakeSender()
  const cap = captureLogger([SECRET_URL])
  let t = 0
  const q = new TxQueue(s, cap.log, [SECRET_URL], {
    pollMs: 1,
    stuckMs: 10,
    timeoutMs: 1_000,
    now: () => t,
    sleep: async (ms) => {
      t += ms
    },
    ...opts,
  })
  return { s, q, cap, advance: (ms: number) => (t += ms) }
}

describe("TxQueue", () => {
  it("sends independent actions back to back with consecutive nonces from the chain, gas +25%", async () => {
    const { s, q } = setup()
    expect(await q.run([act(1), act(2), act(3)])).toEqual({ sent: 3 })
    expect(s.sent.map((x) => x.nonce)).toEqual([7, 8, 9])
    expect(s.sent[0]!.gas).toBe(125_000n)
    expect(q.stats).toMatchObject({ sent: 3, mined: 3, reverted: 0 })
    // Next run keeps counting locally.
    await q.run([act(4)])
    expect(s.sent.at(-1)!.nonce).toBe(10)
  })

  it("never resends a done once-action, and dedupes keys within a batch", async () => {
    const { s, q } = setup()
    await q.run([act(1), act(1)])
    await q.run([act(1)])
    expect(s.sent).toHaveLength(1)
    expect(q.done.has("settle:1")).toBe(true)
  })

  it("repeats non-once actions (checkpoints) every run", async () => {
    const { s, q } = setup()
    await q.run([act(1, { once: false })])
    await q.run([act(1, { once: false })])
    expect(s.sent).toHaveLength(2)
  })

  it("skips actions that are no longer needed, without sending", async () => {
    const { s, q } = setup()
    await q.run([act(1, { stillNeeded: async () => false })])
    expect(s.sent).toHaveLength(0)
    expect(q.done.has("settle:1")).toBe(true)
    expect(q.stats.skipped).toBe(1)
  })

  it("an 'already done' revert in estimation marks the action done (running twice is safe)", async () => {
    const { s, q } = setup()
    s.estimate = () => revert("AlreadySettled")
    await q.run([act(1)])
    expect(s.sent).toHaveLength(0)
    expect(q.done.has("settle:1")).toBe(true)
    expect(q.stats).toMatchObject({ skipped: 1, reverted: 0 })
  })

  it("a permanent revert is dropped; a 'not yet' revert backs off and is retried later", async () => {
    const { s, q, cap } = setup()
    s.estimate = (l) => (l === "1" ? revert("ParentMismatch") : revert("TooEarly"))
    await q.run([act(1), act(2)])
    expect(q.done.has("settle:1")).toBe(true)
    expect(q.done.has("settle:2")).toBe(false)
    expect(cap.text()).toMatch(/would revert/)
    // Backoff: the very next run skips it, a later one tries again and succeeds.
    s.estimate = () => 100_000n
    await q.run([act(2)])
    expect(s.sent).toHaveLength(0)
    for (let i = 0; i < 3; i++) await q.run([act(2)])
    expect(s.sent).toHaveLength(1)
  })

  it("a failed send consumes no nonce and resyncs from the chain", async () => {
    const { s, q } = setup()
    s.sendError = (l) => (l === "1" ? new BaseError("boom") : undefined)
    await q.run([act(1), act(2)])
    expect(s.sent.map((x) => [x.label, x.nonce])).toEqual([["2", 7]])
  })

  it("nonce too low (another tx used it): resyncs and retries", async () => {
    const { s, q } = setup()
    await q.run([act(1)]) // local nonce now 8
    s.chainNonce = 12 // someone else sent from the keeper key
    s.sendError = (_l, n) => (n < 12 ? new BaseError("nonce", { cause: new NonceTooLowError() }) : undefined)
    await q.run([act(2)])
    expect(s.sent).toHaveLength(1)
    for (let i = 0; i < 3; i++) await q.run([act(2)])
    expect(s.sent.at(-1)).toMatchObject({ label: "2", nonce: 12 })
  })

  it("replaces a stuck tx at the same nonce with fees at least +15%", async () => {
    const { s, q } = setup()
    s.mineAfterPolls = 30
    await q.run([act(1)])
    const sends = s.sent.filter((x) => x.label === "1")
    expect(sends.length).toBeGreaterThan(1)
    expect(new Set(sends.map((x) => x.nonce))).toEqual(new Set([7]))
    expect(sends[1]!.fees.maxFeePerGas).toBeGreaterThanOrEqual((sends[0]!.fees.maxFeePerGas * 115n) / 100n)
    expect(sends[1]!.fees.maxPriorityFeePerGas).toBeGreaterThan(sends[0]!.fees.maxPriorityFeePerGas)
    expect(sends.length).toBeLessThanOrEqual(4) // 1 + maxBumps
    expect(q.stats.bumped).toBe(sends.length - 1)
    expect(q.done.has("settle:1")).toBe(true)
  })

  it("gives up after the timeout, resyncs the nonce, retries later (never blocks forever)", async () => {
    const { s, q, cap } = setup({ timeoutMs: 50 })
    s.mineAfterPolls = Number.MAX_SAFE_INTEGER
    await q.run([act(1)])
    expect(q.done.has("settle:1")).toBe(false)
    expect(q.stats.failed).toBe(1)
    expect(cap.text()).toMatch(/not mined before timeout/)
  })

  it("an onchain revert is counted, logged and retried, never marked done", async () => {
    const { s, q } = setup()
    s.status = () => "reverted"
    await q.run([act(1)])
    expect(q.stats.reverted).toBe(1)
    expect(q.done.has("settle:1")).toBe(false)
  })

  it("a failing read in stillNeeded backs off instead of crashing", async () => {
    const { s, q } = setup()
    await q.run([
      act(1, {
        stillNeeded: async () => {
          throw new Error(`fetch failed ${SECRET_URL}`)
        },
      }),
      act(2),
    ])
    expect(s.sent.map((x) => x.label)).toEqual(["2"])
  })

  it("a flaky read (network drop) is retried on the very next run, not pushed into long backoff", async () => {
    const { s, q } = setup()
    let calls = 0
    const flaky = act(1, {
      stillNeeded: async () => {
        calls++
        if (calls <= 5) throw new Error("HTTP request failed. (fetch failed)")
        return true
      },
    })
    for (let i = 0; i < 6; i++) await q.run([flaky])
    expect(calls).toBe(6) // tried on every run
    expect(s.sent).toHaveLength(1)
  })

  it("never logs the RPC URL, even when an error carries it", async () => {
    const { s, q, cap } = setup()
    s.estimate = () => new BaseError("HTTP request failed.", { details: `URL: ${SECRET_URL}` })
    await q.run([act(1)])
    expect(cap.text()).not.toContain("SECRET_RPC_KEY_123")
    expect(cap.text()).toContain("would revert")
  })
})

describe("revertName", () => {
  it("decodes the custom error name through viem's wrapper", () => {
    expect(revertName(revert("BidAlreadyExited"))).toBe("BidAlreadyExited")
    expect(revertName(new Error("x"))).toBeUndefined()
  })
})
