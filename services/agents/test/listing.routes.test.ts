import { toBase } from "@fairtown/shared"
import { DisputeEvidence, LotDraft, TimelineResponse } from "@fairtown/shared/api"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { bootstrapFake } from "../src/bootstrap"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { DraftStore } from "../src/listing/drafts"
import { suggestFloor } from "../src/listing/floor"
import { gradeLot } from "../src/listing/grade"
import { PhotoStore } from "../src/listing/photos"
import { loadReferences } from "../src/listing/references"
import { SellerDirectory } from "../src/sellers"
import { buildApp } from "../src/server"
import { params } from "./helpers"

const photo = (tag: string, lotCode = "4821", gps = true) => ({
  dataUrl: `data:image/jpeg;base64,${Buffer.from(`photo-${tag}`).toString("base64")}`,
  lotCode,
  capturedAt: "2026-11-07T04:45:00+01:00",
  ...(gps ? { gps: { lat: 60.39, lon: 5.32 } } : {}),
})

async function setup(vision: (n: number) => unknown = () => ({ grade: "fresh_a", defects: [], confidence: 0.8, lotCodeVisible: true })) {
  const fake = new FakeAi()
    .on("listing", () => ({ commodity: "cod", quantity: 600, unit: "kg", place: "Bergen" }))
    .on("vision", (i) => vision(i.images))
  const ai = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
  const chain = new FakeChain({ params })
  const sellers = new SellerDirectory(PERSONAS)
  await bootstrapFake(chain, sellers, PERSONAS)
  const drafts = new DraftStore()
  const app = buildApp({
    config: parseConfig({}),
    chain,
    arkiv: new MemoryArkivStore(),
    ai,
    listing: { ai, sellers, photos: new PhotoStore(mkdtempSync(join(tmpdir(), "photos-"))), drafts, references: loadReferences() },
    logger: false,
  })
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload })
  const get = (url: string) => app.inject({ method: "GET", url })
  return { app, chain, sellers, drafts, fake, post, get }
}

describe("listing routes", () => {
  it("turns a Bergen message and photos into a graded draft with a payout preview", async () => {
    const { post, get } = await setup()
    const res = await post("/api/listings/draft", { sellerId: "ingrid", text: "600 kg cod, landed 04:40, Bergen", photos: [photo("a"), photo("b")] })
    expect(res.statusCode).toBe(200)
    const d = LotDraft.parse(res.json())
    expect(d).toMatchObject({
      sector: "fish",
      commodity: "cod",
      qty: "600",
      unit: "kg",
      place: "bergen",
      market: "fish_dock",
      currency: "EUR",
      grade: "fresh_a",
      payoutPreview: { advanceBps: 5000, tier: "new" },
      reference: { perUnit: "8300000", currency: "EUR" },
    })
    expect(BigInt(d.suggestedFloorPerUnit)).toBe(toBase("7.47"))
    expect(res.json().floorBasis[0]).toContain("Reference 8.30")

    const meta = (await get(`/api/lots/meta/${d.draftId}`)).json()
    expect(meta).toMatchObject({ commodity: "cod", qty: "600", grade: "fresh_a", gradeReport: { note: "AI opinion, not a certificate" } })
    expect(meta.photos).toHaveLength(2)
    expect(meta.photos[0]).toMatchObject({ lotCode: "4821", gps: { lat: 60.39, lon: 5.32 } })
    expect(meta.photos[0].hash).toMatch(/^0x[0-9a-f]{64}$/)
    const img = await get(meta.photos[0].url.replace("http://localhost:8787", ""))
    expect(img.statusCode).toBe(200)
    expect(img.headers["content-type"]).toBe("image/jpeg")
  })

  it("confirms a draft into a real LotListed with metadata, then shows view, timeline and seller", async () => {
    const { post, get, chain } = await setup()
    const d = (await post("/api/listings/draft", { sellerId: "ingrid", text: "600 kg cod, Bergen", photos: [photo("c")] })).json()
    const r = await post("/api/listings/confirm", { draftId: d.draftId, floorPerUnit: "7500000", durationBlocks: 45 })
    expect(r.statusCode).toBe(200)
    const { lotId } = r.json()
    const listed = chain.log.filter((e) => e.eventName === "LotListed").at(-1)!
    expect(listed.args).toMatchObject({
      lotId: BigInt(lotId),
      seller: PERSONAS.find((p) => p.id === "ingrid")!.fixtureAgentId,
      qty: 600n,
      floorPerUnit: 7_500_000n,
      metadataURI: `http://localhost:8787/api/lots/meta/${d.draftId}`,
    })
    expect((await post("/api/listings/confirm", { draftId: d.draftId, floorPerUnit: "7500000", durationBlocks: 45 })).statusCode).toBe(409)

    const view = (await get(`/api/lots/${lotId}`)).json()
    expect(view).toMatchObject({ status: "open", clearing: "7500000", spec: { qty: "600", commodity: "cod" } })
    let tl = TimelineResponse.parse((await get(`/api/lots/${lotId}/timeline`)).json())
    expect(tl.steps.map((s) => [s.name, s.status])).toEqual([
      ["Listed", "done"],
      ["Sold", "current"],
    ])
    chain.mine(45)
    tl = TimelineResponse.parse((await get(`/api/lots/${lotId}/timeline`)).json())
    expect(tl.steps.map((s) => s.name)).toEqual(["Listed", "Unsold"])

    const seller = (await get("/api/sellers/ingrid")).json()
    expect(seller).toMatchObject({ tier: "new", record: { cleanLots: 0 }, lots: [{ lotId, status: "unsold" }] })
    expect(seller.payouts).toHaveLength(1)
  })

  it("shows proven and truck tiers", async () => {
    const { post, fake } = await setup()
    fake.on("listing", () => ({ commodity: "onions", quantity: 5, unit: "tonnes", place: "Houston" }))
    expect((await post("/api/listings/draft", { sellerId: "pedro", text: "5 tonnes onions Houston" })).json().payoutPreview).toEqual({
      advanceBps: 9000,
      tier: "proven",
    })
    fake.on("listing", () => ({ commodity: "space", quantity: 18000, unit: "kg", place: "Dallas" }))
    const truck = (await post("/api/listings/draft", { sellerId: "maya", text: "18,000 kg of space Dallas to Houston" })).json()
    expect(truck).toMatchObject({ commodity: "truck_capacity", unit: "kg_route", grade: "na", payoutPreview: { advanceBps: 1000, tier: "truck" } })
  })

  it("flags reused photos and mismatched lot codes", async () => {
    const { post } = await setup()
    await post("/api/listings/draft", { sellerId: "ingrid", text: "600 kg cod, Bergen", photos: [photo("same")] })
    const again = (await post("/api/listings/draft", { sellerId: "ingrid", text: "600 kg cod, Bergen", photos: [photo("same"), photo("x", "9999", false)] })).json()
    const defects: string[] = again.gradeReport.defects
    expect(defects.some((d) => d.includes("used in an earlier listing"))).toBe(true)
    expect(defects.some((d) => d.includes("different lot codes"))).toBe(true)
  })

  it("rejects bad requests with the contract error shape", async () => {
    const { post, get, fake } = await setup()
    expect((await post("/api/listings/draft", { sellerId: "ingrid" })).statusCode).toBe(400)
    expect((await post("/api/listings/draft", { sellerId: "nobody", text: "600 kg cod" })).json()).toEqual({
      error: { code: "unknown_seller", message: "No seller nobody" },
    })
    fake.on("listing", () => {
      throw new Error("down")
    })
    expect((await post("/api/listings/draft", { sellerId: "ingrid", text: "good morning" })).json().error.code).toBe("unreadable")
    expect((await post("/api/listings/draft", { sellerId: "ingrid", audioBase64: "AAAA" })).statusCode).toBe(200)
    expect((await post("/api/listings/confirm", { draftId: "d_nope", floorPerUnit: "7500000", durationBlocks: 45 })).statusCode).toBe(404)
    expect((await get("/api/lots/999")).statusCode).toBe(404)
    expect((await get("/api/lots/abc")).statusCode).toBe(400)
    expect((await get("/api/lots/meta/d_nope")).statusCode).toBe(404)
  })

  it("serves references and dispute evidence", async () => {
    const { post, get, drafts } = await setup()
    expect((await get("/api/reference?commodity=cod&market=bergen")).json()).toMatchObject({ perUnit: "8300000", currency: "EUR" })
    expect((await get("/api/reference?commodity=cod")).statusCode).toBe(400)
    expect((await get("/api/reference?commodity=onion&market=mars")).json().perUnit).toBe("450000")
    const d = (await post("/api/listings/draft", { sellerId: "ingrid", text: "600 kg cod, Bergen", photos: [photo("ev")] })).json()
    const { lotId } = (await post("/api/listings/confirm", { draftId: d.draftId, floorPerUnit: "7500000", durationBlocks: 45 })).json()
    drafts.addDispute({ disputeId: "1", lotId: BigInt(lotId), kind: "quality", handoverPhotos: [] })
    const ev = DisputeEvidence.parse((await get("/api/disputes/1/evidence")).json())
    expect(ev).toMatchObject({ lotId, kind: "quality", grade: "fresh_a" })
    expect(ev.listingPhotos).toHaveLength(1)
    expect(ev.rubric).toContain("EU freshness")
    expect((await get("/api/disputes/2/evidence")).statusCode).toBe(404)
  })
})

describe("grading", () => {
  const ai = (handler: () => unknown) =>
    createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake: new FakeAi().on("vision", handler) })
  const stored = [{ hash: "0x1" as const, file: "", mediaType: "image/jpeg", lotCode: "4821", capturedAt: "", dataUrl: "data:image/jpeg;base64,AA==" }]

  it.each([
    ["fish", "cod", { grade: "unfit", defects: ["sunken eyes", "grey gills"], confidence: 0.9, lotCodeVisible: true }, "unfit"],
    ["produce", "tomato", { grade: "class_2", defects: ["bruising"], confidence: 0.7, lotCodeVisible: true }, "class_2"],
    ["flowers", "marigold", { grade: "bloom_a", defects: [], confidence: 0.8, lotCodeVisible: true }, "bloom_a"],
  ] as const)("accepts a valid %s grade", async (sector, commodity, out, want) => {
    expect((await gradeLot(sector, commodity, stored, ai(() => out))).report.grade).toBe(want)
  })
  it("rejects a grade from another sector's rubric and falls back to na", async () => {
    const r = await gradeLot("fish", "cod", stored, ai(() => ({ grade: "class_1", defects: [], confidence: 0.9, lotCodeVisible: true })))
    expect(r).toMatchObject({ source: "unavailable", report: { grade: "na", defects: ["Grading unavailable"] } })
  })
  it("adds a defect when the lot code is not visible", async () => {
    const r = await gradeLot("fish", "cod", stored, ai(() => ({ grade: "fresh_a", defects: [], confidence: 0.6, lotCodeVisible: false })))
    expect(r.report.defects).toContain("Lot code not visible")
  })
  it("never calls vision for compute, transport or missing photos", async () => {
    const never = ai(() => {
      throw new Error("should not be called")
    })
    expect((await gradeLot("compute", "gpu_hour", [], never)).report.grade).toBe("gpu_verified")
    expect((await gradeLot("truck", "truck_capacity", [], never)).report.grade).toBe("na")
    expect((await gradeLot("fish", "cod", [], never)).report).toMatchObject({ grade: "na", defects: ["No photos"] })
  })
})

describe("floor", () => {
  it("blends reference and recent clears and explains itself", () => {
    expect(suggestFloor({ reference: toBase("8.30"), recent: [], grade: "fresh_a" })!.floorPerUnit).toBe(toBase("7.47"))
    const blend = suggestFloor({ reference: toBase("8.30"), recent: [toBase("9.00"), toBase("9.20"), toBase("8.80")], grade: "fresh_a" })!
    expect(blend.floorPerUnit).toBe(toBase("7.78"))
    expect(blend.basis[0]).toContain("median of last 3 clears 9.00")
    expect(suggestFloor({ recent: [toBase("2.00")], grade: "fresh_b", hoursToExpiry: 2 })!.floorPerUnit).toBe(toBase("1.53"))
    expect(suggestFloor({ recent: [], grade: "na" })).toBeNull()
    expect(suggestFloor({ reference: 900n, recent: [], grade: "na" })!.floorPerUnit).toBe(1_000n)
  })
})
