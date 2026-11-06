import { decodeTicket, toBase } from "@fairtown/shared"
import { CalendarResponse, HandoverTicketResponse } from "@fairtown/shared/api"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { fixtureDisputePhotos } from "../src/handover/disputes"
import { SessionStore } from "../src/handover/sessions"
import { DraftStore } from "../src/listing/drafts"
import { PhotoStore } from "../src/listing/photos"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import { Wallets } from "../src/runtime/wallets"
import { SellerDirectory } from "../src/sellers"
import { buildApp } from "../src/server"
import { ruleStrategy } from "../src/strategies/rule"
import { codSpec, params } from "./helpers"

const PIN = "4821"

async function town(opts: { pin?: string; cap?: number; ticketValidBlocks?: bigint; stt?: Record<string, string> } = {}) {
  let clock = 1_000_000
  const now = () => clock
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const publisher = new MemoryPublisher()
  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy: ruleStrategy, now })
  runtime.addPersonas(PERSONAS)
  await runtime.bootstrap(undefined, [])
  runtime.watchOnly()
  const sellers = new SellerDirectory(PERSONAS, (p) => wallets.address(PERSONAS.indexOf(p)))
  const sessions = new SessionStore(now)
  const drafts = new DraftStore()
  const photos = new PhotoStore(mkdtempSync(join(tmpdir(), "ft-humans-")))
  const config = parseConfig({ ...(opts.pin !== undefined ? { SELLER_PIN: opts.pin } : { SELLER_PIN: PIN }), PUBLIC_WEB_URL: "https://town.example", ...(opts.cap ? { WALKIN_CAP: String(opts.cap) } : {}) })
  const ai = createGateway({ config: parseAiConfig(opts.stt ?? { MOCK_AI: "1" }) })
  const app = buildApp({
    config,
    chain,
    arkiv: new MemoryArkivStore(),
    ai,
    runtime,
    handover: { chain, wallets, runtime, sellers, sessions, photos, drafts, config, ticketValidBlocks: opts.ticketValidBlocks ?? 1500n, now },
    humans: { runtime, publisher, sessions, ai, blockNumber: () => chain.blockNumber(), config, now },
    logger: false,
  })
  const addr = (id: string) => wallets.address(PERSONAS.findIndex((p) => p.id === id))
  const post = (url: string, payload: object, headers: Record<string, string> = {}, remoteAddress = "10.0.0.1") => app.inject({ method: "POST", url, payload, headers, remoteAddress })
  const login = async (sellerId: string) => (await post("/api/sessions/seller", { sellerId, pin: PIN })).json().token as string
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })
  // A sold cod lot with buyers holding tokens.
  const soldCod = async () => {
    const ingrid = addr("ingrid")
    const { lotId } = await chain.createLot(ingrid, codSpec(ingrid))
    for (let i = 0; i < 16; i++) {
      await runtime.step()
      chain.mine(3)
      clock += 10_000
    }
    const holder = [...runtime.agents.values()].find((a) => chain.log.some((e) => e.eventName === "TokensClaimed" && e.args.owner === a.agentId))!
    return { lotId, holder, tokens: await chain.tokenBalance(lotId, holder.agentId) }
  }
  return { chain, runtime, publisher, sessions, drafts, app, addr, post, login, auth, soldCod, tick: (ms: number) => (clock += ms) }
}

describe("seller sessions and handover tickets", () => {
  it("issues a session only for a known seller with the right PIN; disabled without SELLER_PIN", async () => {
    const t = await town()
    expect((await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: "0000" })).statusCode).toBe(401)
    expect((await t.post("/api/sessions/seller", { sellerId: "hanse_kitchen", pin: PIN })).statusCode).toBe(404)
    const ok = await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: PIN })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ sellerId: "ingrid" })
    for (let i = 0; i < 10; i++) await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: "0000" }, {}, "10.0.0.9")
    expect((await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: PIN }, {}, "10.0.0.9")).statusCode).toBe(429)
    const off = await town({ pin: "" })
    expect((await off.post("/api/sessions/seller", { sellerId: "ingrid", pin: PIN })).statusCode).toBe(503)
  })

  it("signs only inside that seller's session, for that seller's lot, for tokens the buyer holds", async () => {
    const t = await town()
    const { lotId, holder, tokens } = await t.soldCod()
    const req = { sellerId: "ingrid", lotId: lotId.toString(), buyer: holder.agentId, tokenAmount: tokens.toString() }
    expect((await t.post("/api/handover/ticket", req)).statusCode).toBe(401)
    const lars = await t.login("lars")
    expect((await t.post("/api/handover/ticket", req, t.auth(lars))).json().error.code).toBe("wrong_seller")
    expect((await t.post("/api/handover/ticket", { ...req, sellerId: "lars" }, t.auth(lars))).json().error.code).toBe("not_your_lot")
    const ingrid = await t.login("ingrid")
    expect((await t.post("/api/handover/ticket", { ...req, tokenAmount: (tokens + 1n).toString() }, t.auth(ingrid))).json().error.code).toBe("insufficient_tokens")
    const ok = await t.post("/api/handover/ticket", req, t.auth(ingrid))
    expect(ok.statusCode).toBe(200)
    const body = HandoverTicketResponse.parse(ok.json())
    const decoded = decodeTicket(body.qrText)
    expect(decoded).toMatchObject({ lotId, buyer: holder.agentId, tokenAmount: tokens })
    expect(decoded.expiryBlock).toBe(t.chain.currentBlock + 1500n)
    expect(body.fallbackUrl.startsWith("https://town.example/scan#t=")).toBe(true)
    expect(Buffer.from(body.fallbackUrl.split("#t=")[1]!, "base64url").toString()).toBe(body.qrText)
  })

  it("rejects an expired session", async () => {
    const t = await town()
    const { lotId, holder, tokens } = await t.soldCod()
    const ingrid = await t.login("ingrid")
    t.tick(2 * 60 * 60 * 1000 + 1)
    const r = await t.post("/api/handover/ticket", { sellerId: "ingrid", lotId: lotId.toString(), buyer: holder.agentId, tokenAmount: tokens.toString() }, t.auth(ingrid))
    expect(r.statusCode).toBe(401)
  })

  it("confirms from the buyer's wallet, refuses reuse, and rejects a stale ticket before sending", async () => {
    const t = await town({ ticketValidBlocks: 5n })
    const { lotId, holder, tokens } = await t.soldCod()
    const ingrid = await t.login("ingrid")
    const req = { sellerId: "ingrid", lotId: lotId.toString(), buyer: holder.agentId, tokenAmount: tokens.toString() }
    const { ticket } = (await t.post("/api/handover/ticket", req, t.auth(ingrid))).json()
    const ok = await t.post("/api/handover/confirm", { receiverId: holder.personaId, ticket })
    expect(ok.statusCode).toBe(200)
    expect(BigInt(ok.json().releasedToSeller)).toBeGreaterThan(0n)
    expect((await t.post("/api/handover/confirm", { receiverId: holder.personaId, ticket })).statusCode).toBe(409)

    const other = [...t.runtime.agents.values()].find((a) => a.agentId !== holder.agentId && t.chain.log.some((e) => e.eventName === "TokensClaimed" && e.args.owner === a.agentId))
    if (!other) throw new Error("need a second token holder for the stale-ticket case")
    const stale = (await t.post("/api/handover/ticket", { ...req, buyer: other.agentId, tokenAmount: (await t.chain.tokenBalance(lotId, other.agentId)).toString() }, t.auth(ingrid))).json().ticket
    t.chain.mine(6)
    const before = t.chain.log.length
    const r = await t.post("/api/handover/confirm", { receiverId: other.personaId, ticket: stale })
    expect(r.json().error.code).toBe("TicketExpired")
    expect(t.chain.log.length).toBe(before)
  })

  it("confirms from the assigned carrier; anyone else is refused", async () => {
    const t = await town()
    const { lotId, holder, tokens } = await t.soldCod()
    const lars = t.addr("lars")
    const truck = await t.chain.createLot(lars, { ...codSpec(lars), sector: "truck", market: "freight_yard", commodity: "truck_capacity", grade: "na", qty: 600n, floorPerUnit: toBase("0.80"), durationBlocks: 30n, parentLotId: lotId })
    t.runtime.assignDuty(holder.agentId, truck.lotId, { commodities: ["truck_capacity"], maxPerUnit: toBase("1.20").toString(), qty: "600", avoidNoShowSellers: false })
    for (let i = 0; i < 12; i++) {
      await t.runtime.step()
      t.chain.mine(3)
      t.tick(10_000)
    }
    expect((await t.chain.getLot(lotId)).settlement!.carrier).toBe(lars)
    const ingrid = await t.login("ingrid")
    const { ticket } = (await t.post("/api/handover/ticket", { sellerId: "ingrid", lotId: lotId.toString(), buyer: holder.agentId, tokenAmount: tokens.toString() }, t.auth(ingrid))).json()
    const wrong = await t.post("/api/handover/confirm", { receiverId: "atlas_labs", ticket })
    expect(wrong.json().error.code).toBe("NotBuyerOrCarrier")
    const ok = await t.post("/api/handover/confirm", { receiverId: "lars", ticket })
    expect(ok.statusCode).toBe(200)
    expect((await t.chain.getLot(lotId)).status).toBe("picked_up")
  })
})

describe("no-show report and contest", () => {
  it("reports only after the deadline; the seller contests with photos inside their session", async () => {
    const t = await town()
    const { lotId, holder, tokens } = await t.soldCod()
    const report = { buyerId: holder.personaId, lotId: lotId.toString(), tokenAmount: tokens.toString() }
    expect((await t.post("/api/noshow/report", report)).json().error.code).toBe("TooEarly")
    const lot = await t.chain.getLot(lotId)
    t.chain.mine(Number(lot.settlement!.pickupDeadline - t.chain.currentBlock) + 1)
    const ok = await t.post("/api/noshow/report", report)
    expect(ok.statusCode).toBe(200)
    expect(ok.json().contestEnds).toBe(Number(t.chain.currentBlock + params.contestWindowBlocks))

    const contest = { sellerId: "ingrid", lotId: lotId.toString(), buyer: holder.agentId, photos: fixtureDisputePhotos(lotId) }
    expect((await t.post("/api/noshow/contest", contest)).statusCode).toBe(401)
    const r = await t.post("/api/noshow/contest", contest, t.auth(await t.login("ingrid")))
    expect(r.statusCode).toBe(200)
    expect(t.drafts.dispute(r.json().disputeId)).toMatchObject({ kind: "no_show" })
    expect((await t.chain.getLot(lotId)).status).toBe("disputed")
  })
})

describe("walk-in", () => {
  it("joins with test money and gas, announces human.joined, and is rate limited per IP", async () => {
    const t = await town()
    const r = await t.post("/api/walkin", { name: "  Priya <3 " })
    expect(r.statusCode).toBe(200)
    const { agentId, token } = r.json()
    const a = t.runtime.agents.get(agentId)!
    expect(a).toMatchObject({ role: "HUMAN", manual: true, name: "Priya 3", currency: "USD" })
    expect(await t.chain.balanceOf("USD", agentId)).toBe(toBase("500"))
    expect(await t.chain.balanceOf("ETH", agentId)).toBeGreaterThan(0n)
    expect(t.publisher.sent.some((e) => e.event.type === "human.joined" && e.event.agentId === agentId)).toBe(true)
    expect(token).toMatch(/^[\w-]{20,}$/)
    await t.post("/api/walkin", { name: "B" })
    await t.post("/api/walkin", { name: "C" })
    expect((await t.post("/api/walkin", { name: "D" })).statusCode).toBe(429)
    expect((await t.post("/api/walkin", { name: "E" }, {}, "10.0.0.2")).statusCode).toBe(200)
    expect((await t.post("/api/walkin", { name: "F", currency: "USDC" }, {}, "10.0.0.3")).statusCode).toBe(400)
  })

  it("stops at the global cap", async () => {
    const t = await town({ cap: 2 })
    expect((await t.post("/api/walkin", { name: "A" }, {}, "1.1.1.1")).statusCode).toBe(200)
    expect((await t.post("/api/walkin", { name: "B" }, {}, "1.1.1.2")).statusCode).toBe(200)
    expect((await t.post("/api/walkin", { name: "C" }, {}, "1.1.1.3")).json().error.code).toBe("walkin_full")
  })

  it("bids through guardrails only when asked, never on its own; expired sessions are refused", async () => {
    const t = await town()
    const { agentId, token } = (await t.post("/api/walkin", { name: "Judge" })).json()
    const ganesh = t.addr("ganesh")
    const { lotId } = await t.chain.createLot(ganesh, codSpec(ganesh, { sector: "flowers", market: "flower_hall", commodity: "marigold", grade: "class_1", place: "pune", currency: "USD", qty: 2000n, floorPerUnit: toBase("0.90"), durationBlocks: 60n }))
    await t.runtime.step()
    expect(t.runtime.log.some((d) => d.agentId === agentId)).toBe(false)
    const clearing = await t.chain.clearingPerUnit(lotId)
    expect((await t.post("/api/walkin/bid", { token, lotId: lotId.toString(), maxPerUnit: clearing.toString(), amount: toBase("100").toString() })).json().error.code).toBe("bid_rejected")
    const price = clearing + toBase("0.20")
    const ok = await t.post("/api/walkin/bid", { token, lotId: lotId.toString(), maxPerUnit: price.toString(), amount: toBase("100").toString() })
    expect(ok.statusCode).toBe(200)
    expect(t.chain.log.some((e) => e.eventName === "BidSubmitted" && e.args.owner === agentId)).toBe(true)
    expect((await t.post("/api/walkin/bid", { token: "nope", lotId: lotId.toString(), maxPerUnit: price.toString(), amount: "1" })).statusCode).toBe(401)
    t.tick(2 * 60 * 60 * 1000 + 1)
    expect((await t.post("/api/walkin/bid", { token, lotId: lotId.toString(), maxPerUnit: price.toString(), amount: toBase("10").toString() })).statusCode).toBe(401)
  })
})

describe("STT and calendar", () => {
  it("transcribes through the gateway; webspeech means the browser does it", async () => {
    const t = await town()
    const r = await t.post("/api/stt", { audioBase64: "AAAA", language: "en-US" })
    expect(r.json()).toEqual({ text: "600 kg cod, landed 04:40, Bergen", provider: "mock" })
    const web = await town({ stt: { MOCK_AI: "0", LLM_BASE_URL: "http://127.0.0.1:9", BIDDER_MODEL: "b", LISTING_MODEL: "l", VISION_MODEL: "v" } })
    expect((await web.post("/api/stt", { audioBase64: "AAAA", language: "en-US" })).statusCode).toBe(503)
    expect((await t.post("/api/stt", { language: "en-US" })).statusCode).toBe(400)
  })

  it("serves festivals by market with dates and sources", async () => {
    const t = await town()
    const all = CalendarResponse.parse((await t.app.inject({ method: "GET", url: "/api/calendar" })).json())
    expect(all.events.length).toBeGreaterThanOrEqual(10)
    expect(all.events.every((e) => e.source.startsWith("https://"))).toBe(true)
    const mumbai = CalendarResponse.parse((await t.app.inject({ method: "GET", url: "/api/calendar?market=mumbai" })).json())
    expect(mumbai.events).toEqual([expect.objectContaining({ name: "Diwali (Lakshmi Puja)", date: "2026-11-08", sectorsAffected: ["flowers", "produce"] })])
    const dallas = CalendarResponse.parse((await t.app.inject({ method: "GET", url: "/api/calendar?market=dallas" })).json())
    expect(dallas.events[0]).toMatchObject({ name: "Thanksgiving", date: "2026-11-26" })
  })
})
