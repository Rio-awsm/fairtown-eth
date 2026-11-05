import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { AiConfigError, parseAiConfig, targetFor, withV1 } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { AiError, createGateway, extractJson } from "../src/ai/gateway"

const Lot = z.object({ commodity: z.string(), qty: z.number(), place: z.string() })
const GOOD = '{"commodity":"cod","qty":600,"place":"bergen"}'

type Seen = { path: string; body: Record<string, unknown>; auth?: string }
let server: Server
let base = ""
let seen: Seen[] = []
let replies: Array<string | { delayMs: number; content: string }> = []
let extra: { trace?: unknown; resKey?: string } = {}
let inFlight = 0
let maxInFlight = 0

function completion(content: string) {
  return {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    ...(extra.trace !== undefined ? { x_0g_trace: extra.trace } : {}),
  }
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  let raw = ""
  for await (const chunk of req) raw += chunk
  const path = req.url ?? ""
  if (path.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: [{ id: "bid-m" }, { id: "list-m" }, { id: "vis-m" }] }))
    return
  }
  if (path.endsWith("/audio/transcriptions")) {
    seen.push({ path, body: {}, auth: req.headers.authorization })
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ text: "600 kilos of cod" }))
    return
  }
  seen.push({ path, body: JSON.parse(raw), auth: req.headers.authorization })
  const next = replies.shift() ?? GOOD
  inFlight++
  maxInFlight = Math.max(maxInFlight, inFlight)
  const { delayMs, content } = typeof next === "string" ? { delayMs: 0, content: next } : next
  setTimeout(() => {
    inFlight--
    if (res.destroyed) return
    res.writeHead(200, { "content-type": "application/json", ...(extra.resKey ? { "ZG-Res-Key": extra.resKey } : {}) })
    res.end(JSON.stringify(completion(content)))
  }, delayMs)
}

beforeAll(async () => {
  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => {
  seen = []
  replies = []
  extra = {}
  inFlight = 0
  maxInFlight = 0
})

const live = (over: Record<string, string> = {}) =>
  parseAiConfig({
    MOCK_AI: "0",
    LLM_BASE_URL: base,
    LLM_API_KEY: "test-key",
    BIDDER_MODEL: "bid-m",
    LISTING_MODEL: "list-m",
    VISION_MODEL: "vis-m",
    ...over,
  })
const ask = { system: "You parse listings.", prompt: "600 kg cod, Bergen", schema: Lot }

describe("AI config", () => {
  it("adds /v1 and resolves each role", () => {
    expect(withV1("https://gw.example.com")).toBe("https://gw.example.com/v1")
    expect(withV1("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1")
    const c = live({ VISION_EXTRA_BODY: '{"verify_tee":true}' })
    expect(targetFor(c, "bidder")).toMatchObject({ model: "bid-m", extraBody: {} })
    expect(targetFor(c, "vision")).toMatchObject({ model: "vis-m", extraBody: { verify_tee: true }, baseURL: `${base}/v1` })
  })
  it("rejects bad config", () => {
    expect(() => live({ VISION_EXTRA_BODY: "[1]" })).toThrow(AiConfigError)
    expect(() => parseAiConfig({ MOCK_AI: "0", LLM_BASE_URL: base })).toThrow(/BIDDER_MODEL/)
    expect(parseAiConfig({}).MOCK_AI).toBe(true)
  })
})

describe("AI gateway against a stub server", () => {
  it("uses native structured output on attempt 1", async () => {
    const r = await createGateway({ config: live() }).decide("listing", ask)
    expect(r).toMatchObject({ value: { commodity: "cod", qty: 600, place: "bergen" }, attempt: 1 })
    expect(seen[0]!.path).toBe("/v1/chat/completions")
    expect(seen[0]!.body.model).toBe("list-m")
    expect((seen[0]!.body.response_format as { type: string }).type).toBe("json_schema")
    expect(seen[0]!.auth).toBe("Bearer test-key")
  })

  it("falls back to JSON mode when structured output is malformed", async () => {
    replies = ["not json at all", "Sure! ```json\n" + GOOD + "\n```"]
    const gw = createGateway({ config: live() })
    const r = await gw.decide("listing", ask)
    expect(r.attempt).toBe(2)
    expect(seen[1]!.body.response_format).toBeUndefined()
    expect(gw.stats().listing).toMatchObject({ calls: 1, ok: 1, fallbacks: 1 })
  })

  it("retries once with the validation error", async () => {
    replies = ["nope", '{"commodity":"cod"}', GOOD]
    const r = await createGateway({ config: live() }).decide("listing", ask)
    expect(r.attempt).toBe(3)
    const lastPrompt = JSON.stringify(seen[2]!.body.messages)
    expect(lastPrompt).toContain("previous answer was invalid")
    expect(lastPrompt).toContain("qty")
  })

  it("throws invalid_output after three bad answers so rules can decide", async () => {
    replies = ["x", "y", "z"]
    const gw = createGateway({ config: live() })
    await expect(gw.decide("bidder", ask)).rejects.toMatchObject({ code: "invalid_output" })
    expect(gw.stats().bidder).toMatchObject({ calls: 1, ok: 0, failures: 1 })
  })

  it("times out and counts it", async () => {
    replies = [{ delayMs: 500, content: GOOD }]
    const gw = createGateway({ config: live() })
    const started = Date.now()
    await expect(gw.decide("bidder", { ...ask, timeoutMs: 100 })).rejects.toMatchObject({ code: "timeout" })
    expect(Date.now() - started).toBeLessThan(400)
    expect(gw.stats().bidder.timeouts).toBe(1)
  })

  it("merges VISION_EXTRA_BODY for vision only and captures 0G trace data", async () => {
    extra = { trace: { request_id: "req-123", provider: "0xprov", tee_verified: true }, resKey: "zg-abc" }
    const gw = createGateway({ config: live({ VISION_EXTRA_BODY: '{"verify_tee":true}' }) })
    const r = await gw.decide("vision", { ...ask, images: [{ data: "data:image/png;base64,iVBORw0KGgo=" }] })
    expect(seen[0]!.body.verify_tee).toBe(true)
    expect(r.trace).toMatchObject({ requestId: "req-123", provider: "0xprov", teeVerified: true, resKey: "zg-abc" })
    const msgs = seen[0]!.body.messages as Array<{ role: string; content: Array<{ type: string; image_url?: { url: string } }> }>
    const content = msgs.find((m) => m.role === "user")!.content
    expect(content.find((p) => p.type === "image_url")!.image_url!.url).toBe("data:image/png;base64,iVBORw0KGgo=")
    await gw.decide("bidder", ask)
    expect(seen[1]!.body.verify_tee).toBeUndefined()
  })

  it("leaves trace undefined when the provider sends none", async () => {
    const r = await createGateway({ config: live() }).decide("bidder", ask)
    expect(r.trace).toBeUndefined()
  })

  it("caps concurrency", async () => {
    replies = Array.from({ length: 4 }, () => ({ delayMs: 80, content: GOOD }))
    const gw = createGateway({ config: live(), concurrency: 2 })
    await Promise.all(Array.from({ length: 4 }, () => gw.decide("bidder", ask)))
    expect(maxInFlight).toBe(2)
  })

  it("reports health and missing models", async () => {
    expect(await createGateway({ config: live() }).health()).toMatchObject({ ok: true })
    const bad = await createGateway({ config: live({ VISION_MODEL: "nope" }) }).health()
    expect(bad).toEqual({ ok: false, detail: "Models not served: vision=nope" })
    const down = await createGateway({ config: live({ LLM_BASE_URL: "http://127.0.0.1:1" }) }).health()
    expect(down.ok).toBe(false)
  })
})

describe("mock mode and STT", () => {
  it("uses the fake provider deterministically", async () => {
    const fake = new FakeAi().on("listing", () => ({ commodity: "cod", qty: 600, place: "bergen" }))
    const gw = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
    expect((await gw.decide("listing", ask)).value.qty).toBe(600)
    await expect(gw.decide("bidder", ask)).rejects.toBeInstanceOf(AiError)
    fake.on("vision", () => ({ commodity: 1 }))
    await expect(gw.decide("vision", ask)).rejects.toMatchObject({ code: "invalid_output" })
    expect(await gw.health()).toEqual({ ok: true, detail: "mock" })
    expect(await gw.transcribe("AAAA")).toEqual({ text: fake.transcript, provider: "mock" })
  })

  it("routes STT by provider", async () => {
    await expect(createGateway({ config: live() }).transcribe("AAAA")).rejects.toThrow(/browser/)
    await expect(createGateway({ config: live({ STT_PROVIDER: "none" }) }).transcribe("AAAA")).rejects.toThrow(/off/)
    const gw = createGateway({ config: live({ STT_PROVIDER: "openai-compatible", STT_MODEL: "whisper-1" }) })
    expect(await gw.transcribe("data:audio/webm;base64,AAAA", "en-US")).toEqual({
      text: "600 kilos of cod",
      provider: "openai-compatible:whisper-1",
    })
    expect(seen[0]!.path).toBe("/v1/audio/transcriptions")
  })
})

describe("extractJson", () => {
  it("finds the first balanced object", () => {
    expect(extractJson('noise {"a":{"b":"}"}} tail {"c":1}')).toEqual({ a: { b: "}" } })
    expect(extractJson("no json")).toBeUndefined()
    expect(extractJson("{broken")).toBeUndefined()
  })
})
