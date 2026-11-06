import { describe, expect, it } from "vitest"
import { planCheckpoints } from "../src/checkpointer"
import { goodsParentOf, planCarriers, planNoShows, planReleases } from "../src/deadlines"
import { planSettles } from "../src/settler"
import { reportKey } from "../src/state"
import { FakeReads, KeeperState, addr, ctx, lot, sale } from "./fakes"

describe("planCheckpoints (D-54)", () => {
  function live() {
    const state = new KeeperState()
    const r = new FakeReads()
    const l = lot(state, { lotId: 1n, startBlock: 100n, endBlock: 550n })
    state.bids.get(1n)!.set(0n, addr(1))
    return { state, r, l }
  }
  it("checkpoints a live auction with bids after 25 quiet blocks, not before", async () => {
    const { state, r, l } = live()
    r.lastCp.set(l.auction, 200n)
    expect(await planCheckpoints(state, ctx(r, 224n))).toHaveLength(0)
    const [a] = await planCheckpoints(state, ctx(r, 225n))
    expect(a!.call.functionName).toBe("checkpoint")
    expect(a!.once).toBe(false)
    expect(await a!.stillNeeded()).toBe(true)
    r.lastCp.set(l.auction, 225n) // a bid checkpointed meanwhile
    expect(await a!.stillNeeded()).toBe(false)
  })
  it("skips auctions with no bids, not started, or at/after the end block", async () => {
    const { state, r, l } = live()
    r.lastCp.set(l.auction, 0n)
    expect(await planCheckpoints(state, ctx(r, 99n))).toHaveLength(0)
    expect(await planCheckpoints(state, ctx(r, 550n))).toHaveLength(0)
    state.bids.get(1n)!.clear()
    expect(await planCheckpoints(state, ctx(r, 300n))).toHaveLength(0)
  })
  it("honours a custom cadence", async () => {
    const { state, r, l } = live()
    r.lastCp.set(l.auction, 200n)
    expect(await planCheckpoints(state, ctx(r, 205n, { checkpointEvery: 5n }))).toHaveLength(1)
  })
})

describe("planSettles", () => {
  it("settles from endBlock (contract: block >= endBlock), zero-bid lots too, once", async () => {
    const state = new KeeperState()
    const r = new FakeReads()
    lot(state, { lotId: 1n, endBlock: 550n })
    expect(planSettles(state, ctx(r, 549n))).toHaveLength(0)
    const [a] = planSettles(state, ctx(r, 550n))
    expect(a!.call.args).toEqual([1n])
    expect(a!.once).toBe(true)
    expect(await a!.stillNeeded()).toBe(true)
    r.sales.set(1n, sale({ settled: true }))
    expect(await a!.stillNeeded()).toBe(false)
    state.settled.set(1n, { soldUnits: 0n, held: 0n, pickupDeadline: 0n })
    expect(planSettles(state, ctx(r, 600n))).toHaveLength(0)
  })
})

describe("planCarriers", () => {
  function chained() {
    const state = new KeeperState()
    const r = new FakeReads()
    lot(state, { lotId: 1n, sector: "fish" })
    lot(state, { lotId: 2n, sector: "truck", parentLotId: 1n, seller: addr(0x77) })
    state.settled.set(1n, { soldUnits: 600n, held: 1n, pickupDeadline: 4_000n })
    state.settled.set(2n, { soldUnits: 600n, held: 1n, pickupDeadline: 4_000n })
    r.sales.set(1n, sale({ sector: "fish" }))
    r.sales.set(2n, sale({ sector: "truck", parentLotId: 1n }))
    return { state, r }
  }
  it("assigns the truck lot to its parent once both are settled", async () => {
    const { state, r } = chained()
    const [a] = planCarriers(state, ctx(r, 1_000n))
    expect(a!.call.functionName).toBe("assignCarrier")
    expect(a!.call.args).toEqual([1n, 2n])
    expect(await a!.stillNeeded()).toBe(true)
  })
  it("waits for the parent to settle (either order works)", () => {
    const { state, r } = chained()
    state.settled.delete(1n)
    expect(planCarriers(state, ctx(r, 1_000n))).toHaveLength(0)
  })
  it("plans one carrier per goods lot, never a truck lot as the parent", () => {
    const { state, r } = chained()
    lot(state, { lotId: 3n, sector: "truck", parentLotId: 2n }) // relist of truck lot 2
    state.settled.set(3n, { soldUnits: 10n, held: 1n, pickupDeadline: 4_000n })
    const plan = planCarriers(state, ctx(r, 1_000n))
    expect(plan.map((a) => a.key)).toEqual(["carrier:1"])
    expect(plan[0]!.call.args).toEqual([1n, 2n])
  })
  it("assigns a relisted truck lot to the goods lot when the first truck lot did not sell (D-61)", async () => {
    const { state, r } = chained()
    state.settled.set(2n, { soldUnits: 0n, held: 0n, pickupDeadline: 0n }) // truck lot 2: no bids
    lot(state, { lotId: 3n, sector: "truck", parentLotId: 2n }) // relist 2 -> 3
    lot(state, { lotId: 4n, sector: "truck", parentLotId: 3n }) // relist 3 -> 4
    state.settled.set(4n, { soldUnits: 400n, held: 1n, pickupDeadline: 4_000n })
    r.sales.set(4n, sale({ sector: "truck", parentLotId: 1n })) // settlement resolved the goods lot
    const [a, ...rest] = planCarriers(state, ctx(r, 1_000n))
    expect(rest).toHaveLength(0)
    expect(a!.call.args).toEqual([1n, 4n])
    expect(await a!.stillNeeded()).toBe(true)
    // If the chain onchain disagrees (old contract without D-61), the keeper does not send.
    r.sales.set(4n, sale({ sector: "truck", parentLotId: 3n }))
    expect(await a!.stillNeeded()).toBe(false)
  })
  it("goodsParentOf follows truck relists, and gives 0 for standalone and undefined for unknown chains", () => {
    const state = new KeeperState()
    lot(state, { lotId: 1n, sector: "fish" })
    lot(state, { lotId: 2n, sector: "truck", parentLotId: 1n })
    lot(state, { lotId: 3n, sector: "truck", parentLotId: 2n })
    lot(state, { lotId: 4n, sector: "truck", parentLotId: 0n })
    lot(state, { lotId: 5n, sector: "truck", parentLotId: 4n })
    lot(state, { lotId: 6n, sector: "truck", parentLotId: 99n })
    expect(goodsParentOf(state, 2n)).toBe(1n)
    expect(goodsParentOf(state, 3n)).toBe(1n)
    expect(goodsParentOf(state, 4n)).toBe(0n)
    expect(goodsParentOf(state, 5n)).toBe(0n)
    expect(goodsParentOf(state, 6n)).toBeUndefined()
    expect(goodsParentOf(state, 42n)).toBeUndefined()
  })
  it("never plans carriers for storage or compute lots", () => {
    const state = new KeeperState()
    const r = new FakeReads()
    lot(state, { lotId: 1n, sector: "fish" })
    lot(state, { lotId: 2n, sector: "storage", parentLotId: 1n })
    lot(state, { lotId: 3n, sector: "compute" })
    for (const id of [1n, 2n, 3n]) state.settled.set(id, { soldUnits: 5n, held: 1n, pickupDeadline: 4_000n })
    expect(planCarriers(state, ctx(r, 1_000n))).toHaveLength(0)
  })
  it("skips unsold truck lots, standalone truck lots and parents that already have a carrier", async () => {
    const { state, r } = chained()
    state.carriers.add(1n)
    expect(planCarriers(state, ctx(r, 1_000n))).toHaveLength(0)
    state.carriers.clear()
    state.settled.set(2n, { soldUnits: 0n, held: 0n, pickupDeadline: 0n })
    expect(planCarriers(state, ctx(r, 1_000n))).toHaveLength(0)
    const s2 = new KeeperState()
    lot(s2, { lotId: 5n, sector: "truck", parentLotId: 0n }) // Dallas standalone
    s2.settled.set(5n, { soldUnits: 10n, held: 1n, pickupDeadline: 1n })
    expect(planCarriers(s2, ctx(r, 1_000n))).toHaveLength(0)
  })
  it("stillNeeded is false once the parent is closed or has a carrier", async () => {
    const { state, r } = chained()
    const [a] = planCarriers(state, ctx(r, 1_000n))
    r.sales.set(1n, sale({ carrier: addr(0x77) }))
    expect(await a!.stillNeeded()).toBe(false)
    r.sales.set(1n, sale({ complete: true }))
    expect(await a!.stillNeeded()).toBe(false)
  })
})

describe("planNoShows", () => {
  const buyer = addr(0xb1)
  function reported(contested = false) {
    const state = new KeeperState()
    const r = new FakeReads()
    state.reports.set(reportKey(1n, buyer), { lotId: 1n, buyer, contestEnds: 5_000n, contested })
    r.reports.set(`1:${buyer}`, { open: true, contested, contestEnds: 5_000n, tokens: 1n })
    return { state, r }
  }
  it("finalizes only after the contest window (contract: block > contestEnds)", async () => {
    const { state, r } = reported()
    expect(planNoShows(state, ctx(r, 5_000n))).toHaveLength(0)
    const [a] = planNoShows(state, ctx(r, 5_001n))
    expect(a!.call.args).toEqual([1n, buyer])
    expect(await a!.stillNeeded()).toBe(true)
  })
  it("never finalizes a contested report", () => {
    const { state, r } = reported(true)
    expect(planNoShows(state, ctx(r, 99_999n))).toHaveLength(0)
  })
  it("stillNeeded is false once closed or contested onchain", async () => {
    const { state, r } = reported()
    const [a] = planNoShows(state, ctx(r, 6_000n))
    r.reports.set(`1:${buyer}`, { open: true, contested: true, contestEnds: 5_000n, tokens: 1n })
    expect(await a!.stillNeeded()).toBe(false)
    r.reports.set(`1:${buyer}`, { open: false, contested: false, contestEnds: 5_000n, tokens: 0n })
    expect(await a!.stillNeeded()).toBe(false)
  })
})

describe("planReleases", () => {
  it("releases after pickupDeadline + reportWindow (contract: block > reportEnds), sold lots only", async () => {
    const state = new KeeperState()
    const r = new FakeReads()
    state.settled.set(1n, { soldUnits: 100n, held: 1n, pickupDeadline: 1_000n })
    state.settled.set(2n, { soldUnits: 0n, held: 0n, pickupDeadline: 1_000n })
    r.sales.set(1n, sale())
    expect(planReleases(state, ctx(r, 4_000n))).toHaveLength(0)
    const out = planReleases(state, ctx(r, 4_001n))
    expect(out.map((a) => a.key)).toEqual(["release:1"])
    expect(await out[0]!.stillNeeded()).toBe(true)
    r.sales.set(1n, sale({ released: true }))
    expect(await out[0]!.stillNeeded()).toBe(false)
    r.sales.set(1n, sale({ complete: true })) // every buyer picked up
    expect(await out[0]!.stillNeeded()).toBe(false)
  })
  it("uses each lot's own pickup deadline: a GPU lot (600-block window) releases before a fish lot", () => {
    const state = new KeeperState()
    const r = new FakeReads()
    lot(state, { lotId: 1n, sector: "fish" })
    lot(state, { lotId: 2n, sector: "compute" })
    state.settled.set(1n, { soldUnits: 100n, held: 1n, pickupDeadline: 550n + 3_000n })
    state.settled.set(2n, { soldUnits: 100n, held: 1n, pickupDeadline: 550n + 600n })
    const at = (head: bigint) => planReleases(state, ctx(r, head)).map((a) => a.key)
    expect(at(550n + 600n + 3_000n)).toEqual([])
    expect(at(550n + 600n + 3_001n)).toEqual(["release:2"])
    expect(at(550n + 3_000n + 3_001n)).toEqual(["release:1", "release:2"])
  })
})
