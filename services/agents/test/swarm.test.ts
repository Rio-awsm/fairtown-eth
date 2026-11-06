import { LotDraft } from "@fairtown/shared/api"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isPlainRef, SwarmStore } from "../src/addons/swarm/store"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { bootstrapFake } from "../src/bootstrap"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { DraftStore } from "../src/listing/drafts"
import { PhotoStore } from "../src/listing/photos"
import { loadReferences } from "../src/listing/references"
import { SellerDirectory } from "../src/sellers"
import { buildApp } from "../src/server"
import { params } from "./helpers"

const BATCH = "a".repeat(64)
const REF = "b".repeat(64)

// Stand-in Bee node: stores uploads by a fake reference; can be switched off or made to answer with an encrypted reference.
function fakeBee(mode: { down?: boolean; encrypted?: boolean; usable?: boolean } = {}) {
  const files = new Map<string, { bytes: Uint8Array; type: string }>()
  const seen: Array<{ url: string; batch?: string | null; type?: string | null }> = []
  let n = 0
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (mode.down) throw new TypeError("fetch failed")
    const h = new Headers(init?.headers)
    seen.push({ url, batch: h.get("swarm-postage-batch-id"), type: h.get("content-type") })
    if (url.includes("/stamps/")) return Response.json({ batchID: BATCH, usable: mode.usable ?? true, batchTTL: 30 * 86_400 })
    if (init?.method === "POST" && url.includes("/bzz")) {
      const ref = mode.encrypted ? REF + REF : `${++n}`.padStart(64, "c") // taken before any await: parallel uploads differ
      files.set(ref, { bytes: new Uint8Array(await (init.body as Blob).arrayBuffer()), type: h.get("content-type") ?? "" })
      return Response.json({ reference: ref })
    }
    const ref = url.split("/bzz/")[1]?.replace(/\/$/, "") ?? ""
    const got = files.get(ref)
    return got ? new Response(got.bytes, { headers: { "content-type": got.type } }) : new Response("not found", { status: 404 })
  }) as typeof fetch
  return { f, files, seen }
}

describe("SwarmStore", () => {
  it("uploads with the batch header, returns a plain reference and reads it back", async () => {
    const bee = fakeBee()
    const s = new SwarmStore({ beeUrl: "http://bee:1633/", batchId: BATCH, fetch: bee.f })
    const ref = await s.upload(new Uint8Array([1, 2, 3]), "image/jpeg", "x.jpg")
    expect(ref && isPlainRef(ref)).toBe(true)
    expect(bee.seen[0]).toMatchObject({ url: "http://bee:1633/bzz?name=x.jpg", batch: BATCH, type: "image/jpeg" })
    expect(await s.read(ref!)).toEqual({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" })
    expect(s.url(ref!)).toBe(`https://bzz.limo/bzz/${ref}/`)
  })

  it("never returns an encrypted reference (it carries its key), and fails soft when the node is down or there is no batch", async () => {
    const enc = new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: fakeBee({ encrypted: true }).f })
    expect(await enc.upload(new Uint8Array([1]), "image/png", "a.png")).toBeUndefined()
    expect(enc.lastError).toContain("unexpected reference length 128")
    const down = new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: fakeBee({ down: true }).f })
    expect(await down.upload(new Uint8Array([1]), "image/png", "a.png")).toBeUndefined()
    expect(down.failed).toBe(1)
    expect(await new SwarmStore({ beeUrl: "http://bee", fetch: fakeBee().f }).upload(new Uint8Array([1]), "image/png", "a.png")).toBeUndefined()
    expect(await down.read("0".repeat(128))).toBeUndefined()
  })

  it("reports health honestly", async () => {
    expect((await new SwarmStore({ beeUrl: "http://bee", fetch: fakeBee().f }).health()).detail).toContain("no SWARM_BATCH_ID")
    expect((await new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: fakeBee({ down: true }).f }).health()).ok).toBe(false)
    expect((await new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: fakeBee({ usable: false }).f }).health()).detail).toContain("not usable")
    expect(await new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: fakeBee().f }).health()).toMatchObject({ ok: true, detail: expect.stringContaining("30 days left") })
  })
})

describe("listing with Swarm, and the local fallback", () => {
  const photo = (tag: string) => ({ dataUrl: `data:image/jpeg;base64,${Buffer.from(`swarm-photo-${tag}-${Math.random()}`).toString("base64")}`, lotCode: "4821", capturedAt: "2026-11-07T04:45:00+01:00", gps: { lat: 60.39, lon: 5.32 } })

  async function setup(swarm?: SwarmStore) {
    const fake = new FakeAi().on("listing", () => ({ commodity: "cod", quantity: 600, unit: "kg", place: "Bergen" })).on("vision", () => ({ grade: "fresh_a", defects: [], confidence: 0.8, lotCodeVisible: true }))
    const ai = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
    const chain = new FakeChain({ params })
    const sellers = new SellerDirectory(PERSONAS)
    await bootstrapFake(chain, sellers, PERSONAS)
    const drafts = new DraftStore()
    const dir = mkdtempSync(join(tmpdir(), "photos-"))
    const app = buildApp({ config: parseConfig({}), chain, arkiv: new MemoryArkivStore(), ai, listing: { ai, sellers, photos: new PhotoStore(dir), drafts, references: loadReferences(), ...(swarm ? { swarm } : {}) }, logger: false })
    return { app, drafts, dir }
  }

  it("copies listing photos to Swarm and shows the reference; serves from Swarm if the local file is gone", async () => {
    const bee = fakeBee()
    const t = await setup(new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: bee.f }))
    const res = await t.app.inject({ method: "POST", url: "/api/listings/draft", payload: { sellerId: "ingrid", text: "600 kg cod, Bergen", photos: [photo("a"), photo("b")] } })
    expect(res.statusCode).toBe(200)
    const { draftId } = LotDraft.parse(res.json())
    const d = (await t.app.inject({ method: "GET", url: `/api/lots/meta/${draftId}` })).json() as { photos: Array<{ hash: string; swarm?: { reference: string; url: string } }> }
    expect(d.photos.every((p) => p.swarm && isPlainRef(p.swarm.reference) && p.swarm.url.startsWith("https://bzz.limo/bzz/"))).toBe(true)
    expect(bee.files.size).toBe(2)

    rmSync(join(t.dir, "photos"), { recursive: true, force: true }) // a fresh deployment lost the disk
    const back = await t.app.inject({ method: "GET", url: `/api/photos/${d.photos[0]!.hash}` })
    expect(back.statusCode).toBe(200)
    expect(back.headers["content-type"]).toContain("image/jpeg")
  })

  it("lists normally on local photos when the Bee node is down", async () => {
    const t = await setup(new SwarmStore({ beeUrl: "http://bee", batchId: BATCH, fetch: fakeBee({ down: true }).f }))
    const res = await t.app.inject({ method: "POST", url: "/api/listings/draft", payload: { sellerId: "ingrid", text: "600 kg cod, Bergen", photos: [photo("c")] } })
    expect(res.statusCode).toBe(200)
    const d = (await t.app.inject({ method: "GET", url: `/api/lots/meta/${LotDraft.parse(res.json()).draftId}` })).json() as { photos: Array<{ hash: string; swarm?: unknown }> }
    expect(d.photos[0]!.swarm).toBeUndefined()
    expect((await t.app.inject({ method: "GET", url: `/api/photos/${d.photos[0]!.hash}` })).statusCode).toBe(200)
  })
})
