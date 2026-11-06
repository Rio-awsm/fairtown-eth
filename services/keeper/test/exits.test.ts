import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { claimGroups, exitCall, planExits } from "../src/exits"
import { exitHints, type CheckpointView } from "../src/lib"
import { FakeReads, KeeperState, addr, ctx, lot } from "./fakes"

/** Written by `forge test` (contracts/test/integration/ExitHintFixtures.t.sol) from a real CCA v2.1.0 auction. */
type Fixture = {
  finalClearing: string
  lastCheckpointed: string
  endBlock: string
  checkpoints: Record<string, { clearingPrice: string; prev: string }>
  bids: Record<
    string,
    { id: string; maxPrice: string; startBlock: string; path: string; lastFullyFilled?: string; outbid?: string }
  >
}
const fx = JSON.parse(readFileSync(new URL("./fixtures/exit-hints.json", import.meta.url), "utf8")) as Fixture
const final = BigInt(fx.finalClearing)
const last = BigInt(fx.lastCheckpointed)
const get = async (b: bigint): Promise<CheckpointView> => {
  const cp = fx.checkpoints[b.toString()]
  if (!cp) throw new Error(`checkpoint ${b} not in fixture`)
  return { block: b, clearingPrice: BigInt(cp.clearingPrice), prev: BigInt(cp.prev) }
}

describe("exit hints from forge fixtures", () => {
  it("fixture covers all three paths, end block checkpointed", () => {
    expect(last).toBe(BigInt(fx.endBlock))
    expect(
      Object.values(fx.bids)
        .map((b) => b.path)
        .sort(),
    ).toEqual(["exitBid", "partial", "partial", "partial"])
    expect(BigInt(fx.bids.A_outbid!.outbid!)).toBeGreaterThan(0n)
  })

  for (const [name, b] of Object.entries(fx.bids)) {
    it(`${name}: same call as the Solidity walk`, async () => {
      const c = await exitCall(BigInt(b.id), { maxPrice: BigInt(b.maxPrice) }, final, last, get)
      if (b.path === "exitBid") {
        expect(c).toEqual({ functionName: "exitBid", args: [BigInt(b.id)] })
      } else {
        expect(c).toEqual({
          functionName: "exitPartiallyFilledBid",
          args: [BigInt(b.id), BigInt(b.lastFullyFilled!), BigInt(b.outbid!)],
        })
      }
    })
  }

  it("hints satisfy the contract's own checks (InvalidLastFullyFilledCheckpointHint, InvalidOutbidBlockCheckpointHint)", async () => {
    // next(b) from the prev links, as the contract stores both directions.
    const next = new Map<bigint, bigint>()
    for (const [blk, cp] of Object.entries(fx.checkpoints)) next.set(BigInt(cp.prev), BigInt(blk))
    for (const b of Object.values(fx.bids).filter((x) => x.path === "partial")) {
      const max = BigInt(b.maxPrice)
      const h = await exitHints(max, last, get)
      const lf = await get(h.lastFullyFilled)
      expect(lf.clearingPrice).toBeLessThan(max)
      expect((await get(next.get(h.lastFullyFilled)!)).clearingPrice).toBeGreaterThanOrEqual(max)
      expect(h.lastFullyFilled).toBeGreaterThanOrEqual(BigInt(b.startBlock))
      if (h.outbid === 0n) expect(final).toBe(max)
      else {
        const ob = await get(h.outbid)
        expect(ob.clearingPrice).toBeGreaterThan(max)
        expect((await get(ob.prev)).clearingPrice).toBeLessThanOrEqual(max)
      }
    }
  })

  it("fails loudly when no checkpoint is below the bid (stale or missing checkpoints)", async () => {
    await expect(exitHints(1n, last, get)).rejects.toThrow(/No fully filled checkpoint/)
  })

  it("a checkpoint read error propagates (no guessed hints)", async () => {
    await expect(
      exitCall(0n, { maxPrice: final }, final, last, async () => {
        throw new Error("rpc down")
      }),
    ).rejects.toThrow(/rpc down/)
  })
})

describe("claimGroups", () => {
  const v = (owner: number, exited: bigint, tokens: bigint) => ({
    owner: addr(owner),
    maxPrice: 1n,
    exitedBlock: exited,
    tokensFilled: tokens,
    startBlock: 1n,
  })
  it("groups exited bids with tokens by owner; skips unexited and empty", () => {
    const g = claimGroups([
      { id: 1n, view: v(1, 9n, 5n) },
      { id: 2n, view: v(1, 9n, 7n) },
      { id: 3n, view: v(2, 9n, 0n) }, // outbid, refunded only
      { id: 4n, view: v(3, 0n, 4n) }, // not exited
    ])
    expect([...g.entries()]).toEqual([[addr(1), [1n, 2n]]])
  })
})

describe("planExits", () => {
  function setup() {
    const state = new KeeperState()
    const r = new FakeReads()
    const l = lot(state, { lotId: 1n, startBlock: 100n, endBlock: 146n })
    state.settled.set(1n, { soldUnits: 100n, held: 1n, pickupDeadline: 9_999n })
    for (const [name, b] of Object.entries(fx.bids)) {
      state.bids.get(1n)!.set(BigInt(b.id), addr(name.charCodeAt(0)))
      r.bids.set(`${l.auction}:${b.id}`, {
        owner: addr(name.charCodeAt(0)),
        maxPrice: BigInt(b.maxPrice),
        exitedBlock: 0n,
        tokensFilled: 0n,
        startBlock: BigInt(b.startBlock),
      })
    }
    for (const [blk, cp] of Object.entries(fx.checkpoints)) {
      r.cps.set(`${l.auction}:${blk}`, {
        block: BigInt(blk),
        clearingPrice: BigInt(cp.clearingPrice),
        prev: BigInt(cp.prev),
      })
    }
    r.lastCp.set(l.auction, last)
    r.clearing.set(l.auction, final)
    return { state, r, l }
  }

  it("plans one exit per open bid, then claims per owner, then nothing", async () => {
    const { state, r, l } = setup()
    const exits = await planExits(state, ctx(r, 200n))
    expect(exits.map((a) => a.call.functionName).sort()).toEqual([
      "exitBid",
      "exitPartiallyFilledBid",
      "exitPartiallyFilledBid",
      "exitPartiallyFilledBid",
    ])
    expect(await exits[0]!.stillNeeded()).toBe(true)
    // All exited; B, C, D got tokens, A was outbid.
    for (const [name, b] of Object.entries(fx.bids)) {
      const key = `${l.auction}:${b.id}`
      r.bids.set(key, { ...r.bids.get(key)!, exitedBlock: 147n, tokensFilled: name === "A_outbid" ? 0n : 10n ** 18n })
    }
    const claims = await planExits(state, ctx(r, 201n))
    expect(claims.map((a) => a.call.functionName)).toEqual(["claimTokensBatch", "claimTokensBatch", "claimTokensBatch"])
    for (const key of r.bids.keys()) r.bids.set(key, { ...r.bids.get(key)!, tokensFilled: 0n })
    expect(await claims[0]!.stillNeeded()).toBe(false)
    expect(await planExits(state, ctx(r, 202n))).toEqual([])
    expect(state.exitsDone.has(1n)).toBe(true)
  })

  it("waits while the end block is not checkpointed (hints would be stale)", async () => {
    const { state, r, l } = setup()
    r.lastCp.set(l.auction, 140n)
    expect(await planExits(state, ctx(r, 200n))).toEqual([])
    expect(state.exitsDone.has(1n)).toBe(false)
  })

  it("never plans exits for an unsettled lot", async () => {
    const { state, r } = setup()
    state.settled.clear()
    expect(await planExits(state, ctx(r, 200n))).toEqual([])
  })

  it("a lot with no bids is done at once", async () => {
    const state = new KeeperState()
    lot(state, { lotId: 2n })
    state.settled.set(2n, { soldUnits: 0n, held: 0n, pickupDeadline: 1n })
    expect(await planExits(state, ctx(new FakeReads(), 600n))).toEqual([])
    expect(state.exitsDone.has(2n)).toBe(true)
  })

  it("reads each checkpoint once per tick across bids (memoized)", async () => {
    const { state, r } = setup()
    const before = r.calls
    await planExits(state, ctx(r, 200n))
    const cpReads = r.calls - before - 2 - 4 // minus lastCheckpointed, clearingPrice and 4 bid reads
    expect(cpReads).toBeLessThanOrEqual(Object.keys(fx.checkpoints).length)
  })
})
