import { toBase } from "@fairtown/shared"
import { DisputeResponse } from "@fairtown/shared/api"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { parseConfig } from "../src/config"
import { buildApp } from "../src/server"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { FakeChain } from "../src/chain/fake/FakeChain"
import type { ChainEventName, EventArgs } from "../src/chain/types"
import { PERSONAS } from "../src/fixtures/personas"
import { fileDispute, fixtureDisputePhotos } from "../src/handover/disputes"
import { DraftStore } from "../src/listing/drafts"
import { PhotoStore } from "../src/listing/photos"
import { loadReferences } from "../src/listing/references"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import { Wallets } from "../src/runtime/wallets"
import { SectorEngine } from "../src/sectors/engine"
import { AUCTION_BLOCKS_FAKE, FAMILIES, pickTruck, poolSplit, pooledQty, relistFloor, slotDays, type TruckState } from "../src/sectors/rules"
import { ruleStrategy } from "../src/strategies/rule"
import { codSpec, params } from "./helpers"

const RULES = {
  auctionBlocks: AUCTION_BLOCKS_FAKE,
  pickupBlocks: { fish: 200n, flowers: 200n, produce: 200n, truck: 200n, storage: 100n, compute: 60n },
  arriveBlocks: 5n,
  travelBlocks: 10n,
}

async function town(opts: { autoNoShowReports?: boolean } = {}) {
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const publisher = new MemoryPublisher()
  // Guardrail rate limits are per wall-clock minute: give the town a clock that moves 10 s per round.
  let clock = 0
  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy: ruleStrategy, markProven: (a) => chain.markProven(a, true), now: () => clock })
  runtime.addPersonas(PERSONAS)
  await runtime.bootstrap(undefined, ["pedro", "maya"])
  const drafts = new DraftStore()
  const photos = new PhotoStore(mkdtempSync(join(tmpdir(), "ft-sectors-")))
  const dd = { chain, wallets, photos, drafts, baseUrl: "http://localhost:8787" }
  const engine = new SectorEngine({
    chain,
    wallets,
    publisher,
    runtime,
    references: loadReferences(),
    rules: RULES,
    fileDispute: (buyer, lotId, tokens) => fileDispute(dd, buyer, lotId, tokens, fixtureDisputePhotos(lotId)),
    humanListed: (uri) => uri.includes("/api/lots/meta/"),
    ...(opts.autoNoShowReports === undefined ? {} : { autoNoShowReports: opts.autoNoShowReports }),
  })
  runtime.watchOnly()
  engine.watchOnly()
  const addr = (id: string) => wallets.address(PERSONAS.findIndex((p) => p.id === id))
  const run = async (rounds: number, blocks = 3) => {
    for (let i = 0; i < rounds; i++) {
      await runtime.step()
      await engine.step()
      chain.mine(blocks)
      clock += 10_000
      await engine.idle()
    }
  }
  const events = <N extends ChainEventName>(name: N) => chain.log.filter((e) => e.eventName === name).map((e) => e.args as EventArgs<N>)
  const intents = (agentId: Address) => publisher.sent.flatMap((e) => (e.event.type === "agent.intent" && e.event.agentId === agentId ? [e.event] : []))
  return { wallets, chain, publisher, runtime, engine, drafts, disputes: dd, addr, run, events, intents }
}

describe("sector rules", () => {
  it("relist floors only decay, round to a cent and stop at the minimum", () => {
    expect(relistFloor(toBase("12.00"), toBase("12.00"), 1500, 6000)).toBe(toBase("10.20"))
    expect(relistFloor(toBase("12.00"), toBase("10.20"), 1500, 6000)).toBe(toBase("8.67"))
    expect(relistFloor(toBase("10.00"), toBase("6.50"), 1500, 6000)).toBe(toBase("6.00"))
    expect(relistFloor(toBase("10.00"), toBase("6.00"), 1500, 6000)).toBeNull()
  })

  it("prefers a truck on a backhaul, and skips busy or wrong-currency trucks", () => {
    const t = (id: string, home: string, at: string, busy = false, currency: "EUR" | "USD" = "EUR"): TruckState => ({ agentId: `0x${id.padStart(40, "0")}` as Address, id, home, at, busy, currency, commodity: "truck_capacity" })
    expect(pickTruck([t("1", "bergen", "bergen"), t("2", "oslo", "bergen")], "bergen", "EUR")!.id).toBe("2")
    expect(pickTruck([t("1", "bergen", "bergen", true), t("2", "bergen", "bergen", false, "USD")], "bergen", "EUR")).toBeUndefined()
  })

  it("sizes storage in slot-days and splits a pooled pickup exactly", () => {
    expect(slotDays(3001n, 1000n, 2)).toBe(8n)
    const split = poolSplit(37n, FAMILIES.shanti_niwas!)
    expect(split.reduce((s, f) => s + f.units, 0n)).toBe(37n)
    expect(split.find((f) => f.name === "Flat 302")!.units).toBeGreaterThan(split.find((f) => f.name === "Flat 405")!.units)
  })
})

describe("sector engine on FakeChain", () => {
  it("Bergen cod: truck lot chained to the parent, buyer bids by duty, pickup and drop-off tickets, paid in full", async () => {
    const t = await town()
    const ingrid = t.addr("ingrid")
    const lars = t.addr("lars")
    const { lotId } = await t.chain.createLot(ingrid, codSpec(ingrid))
    await t.run(45)

    const truckListed = t.events("LotListed").find((l) => l.parentLotId === lotId)!
    expect(truckListed.seller).toBe(lars)
    const carrier = t.events("CarrierAssigned").find((c) => c.lotId === lotId)!
    expect(carrier.carrier).toBe(lars)
    const truckLot = await t.chain.getLot(carrier.truckLotId)
    const winner = t.events("TokensClaimed").find((c) => truckLot.auction && c.owner && t.runtime.log.some((d) => d.lotId === carrier.truckLotId && d.agentId === c.owner))!.owner
    const pickup = t.events("HandoverConfirmed").filter((h) => h.lotId === lotId)
    expect(pickup.length).toBeGreaterThan(0)
    expect(pickup.every((h) => h.receiver === lars)).toBe(true)
    expect(t.events("HandoverConfirmed").find((h) => h.lotId === carrier.truckLotId)!.receiver).toBe(winner)
    expect(t.events("LotDelivered")).toContainEqual({ lotId, truckLotId: carrier.truckLotId })
    expect(t.events("LotPaidInFull").map((e) => e.lotId)).toContain(lotId)

    const cod = (await t.chain.getLot(lotId)).settlement!
    expect(await t.chain.balanceOf("EUR", ingrid)).toBe(cod.raised - cod.fee)
    const truck = truckLot.settlement!
    expect(truck.advanceBps).toBe(1000)
    expect(await t.chain.balanceOf("EUR", lars)).toBe(truck.raised - truck.fee)
    expect(t.intents(lars).map((i) => i.action)).toEqual(expect.arrayContaining(["list", "move", "handover"]))
    expect(t.engine.trucks.find((x) => x.id === "lars")!.busy).toBe(false)
    expect(t.engine.log.filter((l) => !l.includes("not relisting"))).toEqual([])
  })

  it("relists an unsold lot with a decaying floor until buyers bite", async () => {
    const t = await town()
    const ingrid = t.addr("ingrid")
    const { lotId } = await t.chain.createLot(ingrid, codSpec(ingrid, { floorPerUnit: toBase("12.00") }))
    await t.run(40)
    const relists = t.events("LotRelisted")
    expect(relists.map((r) => r.newFloorPerUnit).slice(0, 2)).toEqual([toBase("10.20"), toBase("8.67")])
    expect(relists[0]!.lotId).toBe(lotId)
    const second = await t.chain.getLot(relists[1]!.newLotId)
    expect(second.status).not.toBe("unsold")
    expect(second.spec.parentLotId).toBe(relists[0]!.newLotId)
    expect(t.intents(ingrid).some((i) => i.action === "relist")).toBe(true)
  })

  it("Dallas standalone run: Maya lists capacity, Gulf bids by mandate and releases the rest at drop-off", async () => {
    const t = await town()
    const maya = t.addr("maya")
    const gulf = t.addr("gulf_produce")
    const { lotId } = await t.engine.listCapacity("maya", 18000n, toBase("0.05"))
    await t.run(25)
    const lot = await t.chain.getLot(lotId)
    expect(lot.spec.parentLotId).toBe(0n)
    expect(lot.settlement!.advanceBps).toBe(1000)
    expect(t.events("HandoverConfirmed").find((h) => h.lotId === lotId)!.receiver).toBe(gulf)
    expect(t.events("LotDelivered")).toContainEqual({ lotId, truckLotId: 0n })
    expect(lot.status).toBe("paid_in_full")
    expect(await t.chain.balanceOf("USD", maya)).toBe(lot.settlement!.raised - lot.settlement!.fee)
  })

  it("Lagos tomatoes: the winner books cold storage, the cold store lists slot-days, check-in releases its pay", async () => {
    const t = await town()
    const amina = t.addr("amina")
    const mile12 = t.addr("mile12_coop")
    const hub = t.addr("lagos_cold_hub")
    expect(t.runtime.agents.get(t.addr("eko_court"))!.mandate!.qty).toBe(pooledQty(FAMILIES.eko_court!).toString())
    const { lotId } = await t.chain.createLot(amina, codSpec(amina, { sector: "produce", market: "harvest_hall", commodity: "tomato", grade: "class_1", place: "lagos", currency: "USD", qty: 3000n, floorPerUnit: toBase("0.40"), durationBlocks: 90n }))
    await t.run(60)
    const req = t.events("StorageNeeded").find((s) => s.lotId === lotId)!
    expect(req.requester).toBe(mile12)
    const storage = t.events("LotListed").find((l) => l.parentLotId === lotId && l.seller === hub)!
    expect(storage.qty).toBe(slotDays(req.qty, 1000n, 2))
    const check = t.events("HandoverConfirmed").find((h) => h.lotId === storage.lotId)!
    expect(check.receiver).toBe(mile12)
    expect((await t.chain.getLot(storage.lotId)).status).toBe("paid_in_full")
    expect(t.events("LotListed").some((l) => l.parentLotId === lotId && l.seller === t.addr("kofi"))).toBe(true)
  })

  it("GPU night: simulated provider issues access, healthy buyers confirm; a failed check ends in a no-show refund", async () => {
    const t = await town()
    const good = await t.engine.listCompute("northlight", 200n, toBase("1.80"))
    await t.run(20)
    const recs = t.engine.access.get(good.lotId.toString())!
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.every((r) => r.simulated && r.endpoint.startsWith("sim://"))).toBe(true)
    expect((await t.chain.getLot(good.lotId)).status).toBe("paid_in_full")

    const bad = await t.engine.listCompute("northlight", 100n, toBase("1.80"))
    t.engine.failCompute(bad.lotId)
    await t.run(60)
    expect(t.events("HandoverConfirmed").some((h) => h.lotId === bad.lotId)).toBe(false)
    expect(t.events("NoShowReported").some((r) => r.lotId === bad.lotId)).toBe(true)
    expect(t.events("NoShowRefunded").some((r) => r.lotId === bad.lotId)).toBe(true)
    expect((await t.chain.getLot(bad.lotId)).status).toBe("refunded")
  })

  it("a lot a person listed through /sell is never handed over by the seller's agent (C 1.3)", async () => {
    const t = await town()
    const ingrid = t.addr("ingrid")
    const { lotId } = await t.chain.createLot(ingrid, codSpec(ingrid, { metadataURI: "http://localhost:8787/api/lots/meta/d-1" }))
    await t.run(45)
    expect(t.events("LotSettled").some((s) => s.lotId === lotId)).toBe(true)
    expect(t.events("HandoverConfirmed").some((h) => h.lotId === lotId)).toBe(false)
    expect(t.events("LotListed").some((l) => l.parentLotId === lotId)).toBe(false) // no truck: buyers collect directly
    expect(t.engine.log).toContain(`lot ${lotId}: listed by a person, buyers collect directly`)
  })

  it("buyers do not report no-shows when automatic reports are off (e2e:trust stages them)", async () => {
    const t = await town({ autoNoShowReports: false })
    const coastal = t.addr("coastal_catch")
    const { lotId } = await t.chain.createLot(coastal, codSpec(coastal, { commodity: "haddock", qty: 400n, floorPerUnit: toBase("6.00"), pickupWindowBlocks: 200n }))
    await t.run(110)
    expect(t.events("NoShowReported").some((r) => r.lotId === lotId)).toBe(false)
    expect(t.engine.log).toContain(`lot ${lotId}: automatic no-show reports are off`)
  })

  it("Coastal Catch never signs: buyers report after the deadline and get the held share back", async () => {
    const t = await town()
    const coastal = t.addr("coastal_catch")
    const { lotId } = await t.chain.createLot(coastal, codSpec(coastal, { commodity: "haddock", qty: 400n, floorPerUnit: toBase("6.00"), pickupWindowBlocks: 200n }))
    await t.run(110)
    expect(t.events("HandoverConfirmed").some((h) => h.lotId === lotId)).toBe(false)
    const reports = t.events("NoShowReported").filter((r) => r.lotId === lotId)
    expect(reports.length).toBeGreaterThan(0)
    const refunds = t.events("NoShowRefunded").filter((r) => r.lotId === lotId)
    expect(refunds.map((r) => r.buyer).sort()).toEqual(reports.map((r) => r.buyer).sort())
    expect((await t.chain.sellerRecord(coastal)).noShows).toBe(reports.length)
    expect(t.engine.log).toContain(`lot ${lotId}: seller never shows (seeded)`)
  })

  it("dispute flag: the buyer files a quality dispute with fixture photos instead of confirming", async () => {
    const t = await town()
    const ganesh = t.addr("ganesh")
    const { lotId } = await t.chain.createLot(ganesh, codSpec(ganesh, { sector: "flowers", market: "flower_hall", commodity: "marigold", grade: "class_1", place: "pune", currency: "USD", qty: 2000n, floorPerUnit: toBase("0.90"), durationBlocks: 60n }))
    t.engine.flagDispute(lotId)
    await t.run(30)
    const opened = t.events("DisputeOpened").filter((d) => d.lotId === lotId)
    expect(opened.length).toBeGreaterThan(0)
    expect(opened[0]!.kind).toBe(0)
    expect(opened[0]!.evidenceURI).toContain("/api/disputes/{disputeId}/evidence")
    expect(t.drafts.dispute(opened[0]!.disputeId.toString())!.handoverPhotos).toHaveLength(1)
    expect(t.events("HandoverConfirmed").some((h) => h.lotId === lotId)).toBe(false)
    expect((await t.chain.getLot(lotId)).status).toBe("disputed")
  })
})

describe("POST /api/disputes", () => {
  it("files a quality dispute for a token holder; 400 on bad body, 404 unknown buyer, 409 without tokens", async () => {
    const t = await town()
    const ganesh = t.addr("ganesh")
    const { lotId } = await t.chain.createLot(ganesh, codSpec(ganesh, { sector: "flowers", market: "flower_hall", commodity: "marigold", grade: "class_1", place: "pune", currency: "USD", qty: 2000n, floorPerUnit: toBase("0.90"), durationBlocks: 60n }))
    for (let i = 0; i < 25 && !t.events("LotSettled").some((s) => s.lotId === lotId); i++) {
      await t.runtime.step()
      t.chain.mine(3)
    }
    await t.engine.idle()
    const holder = [...t.runtime.agents.values()].find((a) => t.events("TokensClaimed").some((c) => c.owner === a.agentId))!
    const tokens = await t.chain.tokenBalance(lotId, holder.agentId)
    const app = buildApp({ config: parseConfig({}), chain: t.chain, arkiv: new MemoryArkivStore(), ai: { health: async () => ({ ok: true, detail: "mock" }) }, runtime: t.runtime, disputes: t.disputes, logger: false })
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/disputes", payload })
    const photos = fixtureDisputePhotos(lotId)

    expect((await post({ buyerId: holder.personaId, lotId: lotId.toString() })).statusCode).toBe(400)
    expect((await post({ buyerId: "nobody", lotId: lotId.toString(), tokenAmount: "1", photos })).statusCode).toBe(404)
    const outsider = await post({ buyerId: "atlas_labs", lotId: lotId.toString(), tokenAmount: tokens.toString(), photos })
    expect(outsider.statusCode).toBe(409)
    expect(outsider.json().error.code).toBe("InsufficientTokens")

    const ok = await post({ buyerId: holder.personaId, lotId: lotId.toString(), tokenAmount: tokens.toString(), photos })
    expect(ok.statusCode).toBe(200)
    const body = DisputeResponse.parse(ok.json())
    expect(t.events("DisputeOpened").find((d) => d.disputeId.toString() === body.disputeId)!.buyer).toBe(holder.agentId)
    expect(await t.chain.tokenBalance(lotId, holder.agentId)).toBe(0n)
    await app.close()
  })
})
