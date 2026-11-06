import { BaseError, RpcRequestError, type PublicClient } from "viem"
import { describe, expect, it } from "vitest"
import type { Deployment } from "@fairtown/shared/addresses"
import { MIN_LOG_CHUNK } from "../src/config"
import { Keeper } from "../src/keeper"
import { shrinkLogChunk } from "../src/lib"
import type { TxQueue } from "../src/txQueue"
import { addr, captureLogger } from "./fakes"

const SECRET_URL = "https://base-sepolia.example/v2/SECRET_RPC_KEY_789"
// The exact error a live Base Sepolia RPC returned in the S1 2.1 scenario run.
const limitError = () =>
  new RpcRequestError({
    body: { method: "eth_getLogs" },
    error: { code: -32600, message: "eth_getLogs is limited to a 200 range" },
    url: SECRET_URL,
  })

const dep = {
  deployedAtBlock: 1_000,
  contracts: { LotFactory: addr(1), MarketSettlement: addr(2), DisputeResolver: addr(3) },
} as unknown as Deployment

describe("shrinkLogChunk", () => {
  it("uses the provider's stated limit", () => {
    expect(shrinkLogChunk("RPC Request failed. eth_getLogs is limited to a 200 range", 2_000n, 50n)).toBe(200n)
    expect(shrinkLogChunk("query exceeds max block range 500", 2_000n, 50n)).toBe(500n)
    expect(shrinkLogChunk("block range is too wide: 10000-block range limit", 20_000n, 50n)).toBe(10_000n)
  })
  it("halves when no limit is stated, never below the minimum", () => {
    expect(shrinkLogChunk("response size exceeded", 2_000n, 50n)).toBe(1_000n)
    expect(shrinkLogChunk("range too large", 60n, 50n)).toBe(50n)
    expect(shrinkLogChunk("range too large", 50n, 50n)).toBeUndefined()
  })
  it("ignores errors that are not about the range", () => {
    expect(shrinkLogChunk("fetch failed", 2_000n, 50n)).toBeUndefined()
  })
})

describe("Keeper.sync against an RPC that caps getLogs at 200 blocks", () => {
  function fakePub(head: bigint) {
    const ranges: [bigint, bigint][] = []
    const addresses: string[][] = []
    let rejected = 0
    const pub = {
      async getLogs({ fromBlock, toBlock, address }: { fromBlock: bigint; toBlock: bigint; address: string[] }) {
        if (toBlock - fromBlock + 1n > 200n) {
          rejected++
          throw limitError()
        }
        ranges.push([fromBlock, toBlock])
        addresses.push(address)
        return []
      },
      async readContract() {
        return 3_000n // DisputeResolver.rulingTimeoutBlocks (v2)
      },
      async getBlockNumber() {
        return head
      },
    }
    return { pub: pub as unknown as PublicClient, ranges, addresses, rejected: () => rejected }
  }

  it("drops to the stated limit after one rejection and covers every block exactly once", async () => {
    const { pub, ranges, addresses, rejected } = fakePub(5_000n)
    const cap = captureLogger([SECRET_URL])
    const k = new Keeper({ pub, queue: {} as TxQueue, dep, log: cap.log, checkpointEvery: 25n, secrets: [SECRET_URL] })
    await k.sync(5_000n)
    expect(rejected()).toBe(1)
    expect(k.state.cursor).toBe(5_000n)
    expect(ranges[0]![0]).toBe(1_000n)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1n)
    expect(ranges.every(([f, t]) => t - f + 1n <= 200n)).toBe(true)
    expect(cap.text()).not.toContain("SECRET_RPC_KEY_789")
    // v2: the DisputeResolver's logs come in the same call (S1 4.1).
    expect(addresses[0]).toContain(dep.contracts.DisputeResolver)
    // Later syncs keep the smaller chunk: no more rejections.
    await k.sync(5_600n)
    expect(rejected()).toBe(1)
  })

  it("other getLogs errors are thrown, not retried forever", async () => {
    const pub = {
      async getLogs() {
        throw new Error("fetch failed")
      },
      async readContract() {
        return 3_000n
      },
    } as unknown as PublicClient
    const k = new Keeper({
      pub,
      queue: {} as TxQueue,
      dep,
      log: captureLogger().log,
      checkpointEvery: 25n,
      secrets: [],
    })
    await expect(k.sync(1_100n)).rejects.toThrow(/fetch failed/)
    expect(MIN_LOG_CHUNK).toBeGreaterThan(0n)
  })
})

describe("Keeper on a v1 deployment (stub DisputeResolver)", () => {
  function pub(readError: Error) {
    const addresses: string[][] = []
    let reads = 0
    const p = {
      async getLogs({ address }: { address: string[] }) {
        addresses.push(address)
        return []
      },
      async readContract() {
        reads++
        throw readError
      },
    } as unknown as PublicClient
    return { p, addresses, reads: () => reads }
  }

  it("turns dispute handling off once, says so, and leaves the resolver out of log reads", async () => {
    const { p, addresses, reads } = pub(new BaseError("Execution reverted for an unknown reason."))
    const cap = captureLogger()
    const k = new Keeper({ pub: p, queue: {} as TxQueue, dep, log: cap.log, checkpointEvery: 25n, secrets: [] })
    await k.sync(1_100n)
    await k.sync(1_200n)
    expect(reads()).toBe(1)
    expect(addresses.every((a) => !a.includes(dep.contracts.DisputeResolver))).toBe(true)
    expect(cap.text().match(/dispute expiry off/g)).toHaveLength(1)
  })

  it("a network error reading the resolver is thrown, not mistaken for v1", async () => {
    const { p } = pub(new Error("fetch failed"))
    const k = new Keeper({
      pub: p,
      queue: {} as TxQueue,
      dep,
      log: captureLogger().log,
      checkpointEvery: 25n,
      secrets: [],
    })
    await expect(k.sync(1_100n)).rejects.toThrow(/fetch failed/)
  })
})

describe("Keeper.loop on a flaky network", () => {
  it("logs failures without the URL, says when it recovers, and sends a heartbeat while idle", async () => {
    let n = 0
    const stop = new AbortController()
    const pub = {
      async getBlockNumber() {
        n++
        if (n <= 2) throw new Error(`HTTP request failed. URL: ${SECRET_URL} (fetch failed)`)
        if (n >= 5) stop.abort()
        return 1_000n
      },
      async getLogs() {
        return []
      },
      async readContract({ functionName }: { functionName: string }) {
        return functionName === "lotCount" ? 0n : 3_000n // no lots yet; reportWindowBlocks
      },
    } as unknown as PublicClient
    const cap = captureLogger([SECRET_URL])
    const queue = { run: async () => ({ sent: 0 }), stats: { sent: 0 } } as unknown as TxQueue
    const k = new Keeper({ pub, queue, dep, log: cap.log, checkpointEvery: 25n, secrets: [SECRET_URL] })
    await k.loop(1, stop.signal, 0)
    const lines = cap.lines.map((l) => JSON.parse(l) as { msg: string; failures?: number })
    expect(lines.filter((l) => l.msg === "tick failed").map((l) => l.failures)).toEqual([1, 2])
    expect(lines.find((l) => l.msg === "tick recovered")?.failures).toBe(2)
    expect(lines.some((l) => l.msg === "alive")).toBe(true)
    expect(cap.text()).not.toContain("SECRET_RPC_KEY_789")
  })
})
