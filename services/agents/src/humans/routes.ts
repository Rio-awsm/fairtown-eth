import { COMMODITIES, toBase, type Currency } from "@fairtown/shared"
import { CalendarResponse, SttRequest, SttResponse, WalkinBidRequest, WalkinRequest, WalkinResponse } from "@fairtown/shared/api"
import type { FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { z } from "zod"
import type { AiGateway } from "../ai/gateway"
import { SttError } from "../ai/stt"
import { RateLimiter, SESSION_MS, type SessionStore } from "../handover/sessions"
import { HttpError, parse } from "../listing/routes"
import type { Publisher } from "../runtime/publisher"
import type { AgentRuntime } from "../runtime/runtime"

export type HumanDeps = {
  runtime: AgentRuntime
  publisher: Publisher
  sessions: SessionStore
  ai: Pick<AiGateway, "transcribe">
  blockNumber: () => Promise<bigint>
  config: { WALKIN_BUDGET: string; WALKIN_CAP: number }
  now?: () => number
}

const WalkinBidResponse = z.object({ bidId: z.string(), tx: z.string() })
const WALKIN_CURRENCIES: Currency[] = ["USD", "EUR"] // USDC comes from the Circle faucet, not mint

export const loadCalendar = () => CalendarResponse.parse(JSON.parse(readFileSync(new URL("../data/festivals.json", import.meta.url), "utf8")))

// Strip control and markup characters: the name is drawn over a sprite in town.
const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 32)

export function registerHumanRoutes(app: FastifyInstance, d: HumanDeps) {
  const joins = new RateLimiter(3, 10 * 60_000, d.config.WALKIN_CAP, d.now)
  const calendar = loadCalendar()

  // New wallet, HUMAN role, test money and gas (runtime bootstrap), a 2 h session, then human.joined for the town.
  app.post("/api/walkin", async (req) => {
    const body = parse(WalkinRequest, req.body)
    const name = cleanName(body.name)
    if (!name) throw new HttpError(400, "bad_request", "Pick a name")
    const currency = body.currency ?? "USD"
    if (!WALKIN_CURRENCIES.includes(currency)) throw new HttpError(400, "bad_currency", `Walk-ins play in USD or EUR, not ${currency}`)
    const slot = joins.take(req.ip)
    if (!slot.ok) throw slot.reason === "cap_reached" ? new HttpError(503, "walkin_full", "The market is full, try again later") : new HttpError(429, "rate_limited", "Three joins per 10 minutes from one place")
    const budget = toBase(d.config.WALKIN_BUDGET)
    const agent = d.runtime.addAgent({
      name,
      role: "HUMAN",
      kind: "custom",
      building: "town_gate",
      sprite: "visitor",
      currency,
      budget,
      // Guardrails still apply: budget, 60% per auction, tick above clearing, rate limit. The human picks the price.
      mandate: { commodities: [...COMMODITIES], maxPerUnit: budget.toString(), avoidNoShowSellers: false },
      manual: true,
    })
    await d.runtime.bootstrap([agent])
    await d.publisher.publish([{ type: "human.joined", agentId: agent.agentId, name }], Number(await d.blockNumber()))
    const s = d.sessions.create("walkin", agent.agentId, SESSION_MS)
    return WalkinResponse.parse({ agentId: agent.agentId, address: agent.agentId, token: s.token })
  })

  app.post("/api/walkin/bid", async (req) => {
    const body = parse(WalkinBidRequest, req.body)
    const s = d.sessions.get(body.token, "walkin")
    if (!s) throw new HttpError(401, "no_session", "Your visit has ended, join again")
    const agent = d.runtime.agents.get(s.subject as `0x${string}`)
    if (!agent) throw new HttpError(401, "no_session", "Your visit has ended, join again")
    const r = await d.runtime.manualBid(agent.agentId, BigInt(body.lotId), BigInt(body.maxPerUnit), BigInt(body.amount), `${agent.name} bids from a phone`)
    if (r.result.status === "bid") return WalkinBidResponse.parse({ bidId: r.result.bidId.toString(), tx: r.result.tx })
    if (r.result.status === "failed") throw new HttpError(502, "bid_failed", "The bid didn't go through, try again")
    throw new HttpError(409, "bid_rejected", r.result.reason)
  })

  app.post("/api/stt", async (req) => {
    const body = parse(SttRequest, req.body)
    try {
      return SttResponse.parse(await d.ai.transcribe(body.audioBase64, body.language))
    } catch (e) {
      if (e instanceof SttError) throw new HttpError(503, e.code, e.message)
      throw new HttpError(502, "stt_failed", "Speech to text failed")
    }
  })

  app.get<{ Querystring: { market?: string } }>("/api/calendar", async (req) => {
    const m = req.query.market
    return CalendarResponse.parse({ events: m ? calendar.events.filter((e) => e.market === m) : calendar.events })
  })
}
