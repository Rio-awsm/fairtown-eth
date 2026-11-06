import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { english, generateMnemonic } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { BOT_TOKEN_HEADER, BOT_USER_HEADER } from "../src/callers"
import { FakeChain } from "../src/chain/fake/FakeChain"
import { parseConfig } from "../src/config"
import { PERSONAS } from "../src/fixtures/personas"
import { SessionStore } from "../src/handover/sessions"
import { DraftStore } from "../src/listing/drafts"
import { PhotoStore } from "../src/listing/photos"
import { loadReferences } from "../src/listing/references"
import { MemoryPublisher } from "../src/runtime/publisher"
import { AgentRuntime } from "../src/runtime/runtime"
import { Wallets } from "../src/runtime/wallets"
import { SellerDirectory } from "../src/sellers"
import { REDACT, buildApp } from "../src/server"
import { ruleStrategy } from "../src/strategies/rule"
import { params } from "./helpers"

// TG 0.2 (ICR-012): the Telegram bot's service token, per-user rate limits and owner checks. Test-only values.
const PIN = "4821"
const SERVICE = "test-only-service-token-0123456789abcdef"
const IP = "10.0.0.1"
const A = "1001"
const B = "2002"

const photo = (tag: string) => ({
  dataUrl: `data:image/jpeg;base64,${Buffer.from(`photo-${tag}`).toString("base64")}`,
  lotCode: "4821",
  capturedAt: "2026-11-07T04:45:00+01:00",
})

async function town(opts: { service?: string | null } = {}) {
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params, accountFor: wallets.accountFor })
  const publisher = new MemoryPublisher()
  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy: ruleStrategy })
  runtime.addPersonas(PERSONAS)
  await runtime.bootstrap(undefined, [])
  runtime.watchOnly()
  const sellers = new SellerDirectory(PERSONAS, (p) => wallets.address(PERSONAS.indexOf(p)))
  const sessions = new SessionStore()
  const drafts = new DraftStore()
  const photos = new PhotoStore(mkdtempSync(join(tmpdir(), "ft-callers-")))
  const service = opts.service === undefined ? SERVICE : opts.service
  const config = parseConfig({ SELLER_PIN: PIN, PUBLIC_WEB_URL: "https://town.example", ...(service ? { TELEGRAM_SERVICE_TOKEN: service } : {}) })
  const fake = new FakeAi()
    .on("listing", () => ({ commodity: "cod", quantity: 600, unit: "kg", place: "Bergen" }))
    .on("vision", () => ({ grade: "fresh_a", defects: [], confidence: 0.8, lotCodeVisible: true }))
  const ai = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
  const app = buildApp({
    config,
    chain,
    arkiv: new MemoryArkivStore(),
    ai,
    runtime,
    listing: { ai, sellers, sessions, photos, drafts, references: loadReferences() },
    disputes: { chain, wallets, photos, drafts, baseUrl: "http://localhost:8787" },
    handover: { chain, wallets, runtime, sellers, sessions, photos, drafts, config, ticketValidBlocks: 1500n },
    humans: { runtime, publisher, sessions, ai, blockNumber: () => chain.blockNumber(), config },
    logger: false,
  })
  const bot = (user: string, token = SERVICE) => ({ [BOT_TOKEN_HEADER]: token, [BOT_USER_HEADER]: user })
  const send = (method: "POST" | "PATCH" | "GET", url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, ...(payload ? { payload } : {}), headers, remoteAddress: IP })
  const post = (url: string, payload: object, headers: Record<string, string> = {}) => send("POST", url, payload, headers)
  const login = async (sellerId: string, headers: Record<string, string> = {}) => (await post("/api/sessions/seller", { sellerId, pin: PIN }, headers)).json().token as string
  const walkin = async (user: string) => (await post("/api/walkin", { name: `tg ${user}` }, bot(user))).json() as { agentId: string; token: string }
  return { app, chain, runtime, drafts, bot, send, post, login, walkin }
}

describe("service token for the Telegram bot", () => {
  it("refuses a wrong service token on every route, before the body is read", async () => {
    const t = await town()
    for (const [method, url] of [["GET", "/api/health"], ["POST", "/api/walkin"], ["POST", "/api/sessions/seller"]] as const) {
      const r = await t.send(method, url, method === "POST" ? { name: "x" } : undefined, t.bot(A, "wrong-token-of-the-same-length-0123456789"))
      expect(r.statusCode).toBe(401)
      expect(r.json().error.code).toBe("bad_service_token")
    }
  })

  it("refuses all bot calls when TELEGRAM_SERVICE_TOKEN is unset", async () => {
    const t = await town({ service: null })
    const r = await t.post("/api/walkin", { name: "x" }, t.bot(A))
    expect(r.statusCode).toBe(401)
    expect((await t.send("GET", "/api/health")).statusCode).toBe(200) // direct callers unaffected
  })

  it("needs a numeric Telegram user id with a valid token", async () => {
    const t = await town()
    expect((await t.post("/api/walkin", { name: "x" }, { [BOT_TOKEN_HEADER]: SERVICE })).statusCode).toBe(400)
    expect((await t.post("/api/walkin", { name: "x" }, t.bot("@alice"))).statusCode).toBe(400)
  })

  it("keeps a too-short service token out of the config", () => {
    expect(() => parseConfig({ TELEGRAM_SERVICE_TOKEN: "short" })).toThrow()
  })

  it("redacts the service token header in request logs", () => {
    expect(REDACT).toContain('req.headers["x-fairtown-bot"]')
  })
})

describe("rate limits per Telegram user", () => {
  it("locks out only the bot user who keeps guessing the PIN", async () => {
    const t = await town()
    for (let i = 0; i < 10; i++) expect((await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: "0000" }, t.bot(A))).statusCode).toBe(401)
    expect((await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: PIN }, t.bot(A))).statusCode).toBe(429)
    expect((await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: PIN }, t.bot(B))).statusCode).toBe(200)
    expect((await t.post("/api/sessions/seller", { sellerId: "ingrid", pin: PIN })).statusCode).toBe(200) // same IP, direct
  })

  it("gives each bot user their own walk-in allowance", async () => {
    const t = await town()
    for (let i = 0; i < 3; i++) expect((await t.post("/api/walkin", { name: `a${i}` }, t.bot(A))).statusCode).toBe(200)
    expect((await t.post("/api/walkin", { name: "a3" }, t.bot(A))).statusCode).toBe(429)
    expect((await t.post("/api/walkin", { name: "b0" }, t.bot(B))).statusCode).toBe(200)
  })

  it("ignores a Telegram user header sent without the service token", async () => {
    const t = await town()
    for (let i = 0; i < 3; i++) expect((await t.post("/api/walkin", { name: `x${i}` }, { [BOT_USER_HEADER]: String(9000 + i) })).statusCode).toBe(200)
    // Still one IP: a browser cannot dodge the limit by inventing Telegram users.
    expect((await t.post("/api/walkin", { name: "x3" }, { [BOT_USER_HEADER]: "9999" })).statusCode).toBe(429)
    const agents = [...t.runtime.agents.values()].filter((a) => a.role === "HUMAN")
    expect(agents.every((a) => a.owner === undefined)).toBe(true)
  })
})

describe("owner checks for agents made through the bot", () => {
  it("marks a bot walk-in as that Telegram user's and only lets them patch it", async () => {
    const t = await town()
    const w = await t.walkin(A)
    expect(t.runtime.agents.get(w.agentId as `0x${string}`)!.owner).toBe(`tg:${A}`)
    expect((await t.send("PATCH", `/api/agents/${w.agentId}`, { paused: true }, t.bot(A))).statusCode).toBe(200)
    const other = await t.send("PATCH", `/api/agents/${w.agentId}`, { paused: false }, t.bot(B))
    expect(other.statusCode).toBe(403)
    expect(other.json().error.code).toBe("not_your_agent")
    expect((await t.send("PATCH", `/api/agents/${w.agentId}`, { paused: false })).statusCode).toBe(403) // web, no owner
    expect(t.runtime.agents.get(w.agentId as `0x${string}`)!.paused).toBe(true)
  })

  it("leaves persona and web-made agents patchable as before", async () => {
    const t = await town()
    const persona = [...t.runtime.agents.values()].find((a) => a.role === "BUYER")!
    expect((await t.send("PATCH", `/api/agents/${persona.agentId}`, { paused: true })).statusCode).toBe(200)
    const buyer = { name: "Console buyer", role: "BUYER", currency: "EUR", budget: "1000000000", mandate: { commodities: ["cod"], maxPerUnit: "9000000" } }
    const web = (await t.post("/api/buyers", buyer)).json()
    expect(t.runtime.agents.get(web.agentId)!.owner).toBeUndefined()
    expect((await t.send("PATCH", `/api/agents/${web.agentId}`, { paused: true })).statusCode).toBe(200)
    const viaBot = (await t.post("/api/buyers", buyer, t.bot(A))).json()
    expect(t.runtime.agents.get(viaBot.agentId)!.owner).toBe(`tg:${A}`)
    expect((await t.send("PATCH", `/api/agents/${viaBot.agentId}`, { paused: true }, t.bot(B))).statusCode).toBe(403)
  })

  it("refuses a walk-in bid when another bot user presents the session", async () => {
    const t = await town()
    const w = await t.walkin(A)
    const r = await t.post("/api/walkin/bid", { token: w.token, lotId: "1", maxPerUnit: "1000", amount: "1000" }, t.bot(B))
    expect(r.statusCode).toBe(403)
  })

  it("refuses no-show reports, disputes and handover confirms for someone else's agent", async () => {
    const t = await town()
    const w = await t.walkin(A)
    const noshow = await t.post("/api/noshow/report", { buyerId: w.agentId, lotId: "1", tokenAmount: "1" }, t.bot(B))
    expect(noshow.statusCode).toBe(403)
    expect((await t.post("/api/noshow/report", { buyerId: w.agentId, lotId: "1", tokenAmount: "1" })).statusCode).toBe(403)
    const dispute = await t.post("/api/disputes", { buyerId: w.agentId, lotId: "1", tokenAmount: "1", photos: [photo("d")] }, t.bot(B))
    expect(dispute.statusCode).toBe(403)
    const ticket = { lotId: "1", buyer: w.agentId, tokenAmount: "1", expiryBlock: "999999", sig: `0x${"11".repeat(65)}` }
    expect((await t.post("/api/handover/confirm", { receiverId: w.agentId, ticket }, t.bot(B))).statusCode).toBe(403)
    // The owner gets past the owner check; the chain then judges the (fake) ticket.
    expect((await t.post("/api/handover/confirm", { receiverId: w.agentId, ticket }, t.bot(A))).statusCode).not.toBe(403)
  })
})

describe("listing through the bot", () => {
  const draft = { sellerId: "ingrid", text: "600 kg cod, landed 04:40, Bergen" }

  it("needs the seller's session for a bot draft", async () => {
    const t = await town()
    const none = await t.post("/api/listings/draft", draft, t.bot(A))
    expect(none.statusCode).toBe(401)
    expect(none.json().error.code).toBe("no_session")
    const asOther = await t.login("lars")
    const wrong = await t.post("/api/listings/draft", draft, { ...t.bot(A), authorization: `Bearer ${asOther}` })
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().error.code).toBe("wrong_seller")
  })

  it("lets only the bot user who drafted it confirm it", async () => {
    const t = await town()
    const session = await t.login("ingrid", t.bot(A))
    const d = await t.post("/api/listings/draft", draft, { ...t.bot(A), authorization: `Bearer ${session}` })
    expect(d.statusCode).toBe(200)
    const draftId = d.json().draftId as string
    expect(d.json()).not.toHaveProperty("owner")
    expect(t.drafts.get(draftId)!.owner).toBe(`tg:${A}`)
    const confirm = { draftId, floorPerUnit: "7500000", durationBlocks: 40 }
    const byB = await t.post("/api/listings/confirm", confirm, t.bot(B))
    expect(byB.statusCode).toBe(403)
    expect(byB.json().error.code).toBe("not_your_draft")
    expect((await t.post("/api/listings/confirm", confirm)).statusCode).toBe(403)
    expect(t.drafts.get(draftId)!.confirmed).toBeUndefined()
    const byA = await t.post("/api/listings/confirm", confirm, t.bot(A))
    expect(byA.statusCode).toBe(200)
    expect(byA.json().lotId).toMatch(/^\d+$/)
  })

  it("keeps the web flow unchanged: draft and confirm with no session", async () => {
    const t = await town()
    const d = await t.post("/api/listings/draft", draft)
    expect(d.statusCode).toBe(200)
    expect(t.drafts.get(d.json().draftId)!.owner).toBeUndefined()
    expect((await t.post("/api/listings/confirm", { draftId: d.json().draftId, floorPerUnit: "7500000", durationBlocks: 40 })).statusCode).toBe(200)
  })
})
