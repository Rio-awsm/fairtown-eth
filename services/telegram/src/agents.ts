import {
  AdviceResponse,
  AgentView,
  BidResponse,
  ConfirmResponse,
  DisputeResponse,
  HandoverConfirmResponse,
  HandoverTicketResponse,
  LotDraft,
  NoShowReportResponse,
  TimelineResponse,
  WalkinResponse,
} from "@fairtown/shared/api"
import type { TicketJson } from "@fairtown/shared/handover"
import { z } from "zod"

// HTTP client for the agents service (:8787). Every call carries the bot's service token and the Telegram user it acts
// for (ICR-012), so the agents service limits and checks ownership per user. Replies are zod-validated. Errors never
// carry request bodies: a PIN or session token must not reach a log.
export const BOT_TOKEN_HEADER = "x-fairtown-bot"
export const BOT_USER_HEADER = "x-telegram-user"

export class AgentsError extends Error {
  constructor(
    readonly status: number, // 0 = no answer
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export const SellerSession = z.object({ token: z.string().min(1), sellerId: z.string(), expiresAt: z.iso.datetime() })
export const SellerInfo = z.looseObject({ sellerId: z.string(), name: z.string(), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
export type SellerSession = z.infer<typeof SellerSession>
export type SellerInfo = z.infer<typeof SellerInfo>
export type AgentInfo = z.infer<typeof AgentView>
export type Walkin = z.infer<typeof WalkinResponse>
export type WalkinCurrency = "USD" | "EUR"
// The draft route returns the shared LotDraft plus why it chose the floor.
export const DraftView = LotDraft.extend({ floorBasis: z.array(z.string()).optional() })
export type DraftView = z.infer<typeof DraftView>
export type DraftPhoto = { dataUrl: string; lotCode: string; capturedAt: string }
export type DraftBody = { sellerId: string; text: string; photos: DraftPhoto[] }
export type ConfirmBody = { draftId: string; floorPerUnit: string; durationBlocks: number }
export type Confirmed = z.infer<typeof ConfirmResponse>

const Dec = z.string().regex(/^\d+$/)
const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
// GET /api/lots/:id. Only the fields the bot reads are checked; the rest passes through.
export const LotInfo = z.looseObject({
  lotId: Dec,
  status: z.string(),
  spec: z.looseObject({ seller: Addr, commodity: z.string(), qty: Dec, floorPerUnit: Dec, currency: z.string(), place: z.string(), market: z.string(), sector: z.string() }),
  clearing: Dec.optional(),
  endBlock: Dec.optional(),
  bidCount: z.number().int().optional(),
  settlement: z
    .looseObject({ finalClearingPerUnit: Dec, soldUnits: Dec, sellerPaid: Dec, held: Dec, heldRemaining: Dec, fee: Dec, pickupDeadline: Dec, advanceBps: z.number().int() })
    .optional(),
  winners: z.array(z.object({ buyer: Addr, tokenAmount: Dec })).optional(),
})
export type LotInfo = z.infer<typeof LotInfo>
export const SellerProfile = SellerInfo.extend({
  tier: z.string().optional(),
  record: z.looseObject({ cleanLots: z.number().int(), noShows: z.number().int(), proven: z.boolean() }).optional(),
  lots: z.array(z.looseObject({ lotId: Dec, status: z.string(), spec: z.looseObject({ commodity: z.string(), qty: Dec, currency: z.string() }), clearingPerUnit: Dec.optional() })).optional(),
  payouts: z.array(z.looseObject({ lotId: Dec, kind: z.string(), amount: Dec, currency: z.string() })).optional(),
})
export type SellerProfile = z.infer<typeof SellerProfile>
export type Timeline = z.infer<typeof TimelineResponse>
export type Ticket = z.infer<typeof HandoverTicketResponse>
export type PhotoBody = { dataUrl: string; lotCode: string; capturedAt: string }

export type AgentsClient = {
  sellerSession(user: number, sellerId: string, pin: string): Promise<SellerSession>
  seller(user: number, sellerId: string): Promise<SellerInfo>
  agent(user: number, agentId: string): Promise<AgentInfo>
  walkin(user: number, name: string, currency: WalkinCurrency): Promise<Walkin>
  // Needs the seller's session (ICR-012): a bot user drafts only as the seller they signed in as.
  draft(user: number, session: string, body: DraftBody): Promise<DraftView>
  confirm(user: number, body: ConfirmBody): Promise<Confirmed>
  sellerProfile(user: number, sellerId: string): Promise<SellerProfile>
  advice(user: number, sellerId: string): Promise<z.infer<typeof AdviceResponse>>
  lot(user: number, lotId: string): Promise<LotInfo>
  timeline(user: number, lotId: string): Promise<Timeline>
  // Walk-in bids go through the agents runtime's guardrails (budget, 60% per auction, tick above clearing, rate limit).
  bid(user: number, body: { token: string; lotId: string; maxPerUnit: string; amount: string }): Promise<z.infer<typeof BidResponse>>
  ticket(user: number, session: string, body: { sellerId: string; lotId: string; buyer: string; tokenAmount: string }): Promise<Ticket>
  confirmHandover(user: number, body: { receiverId: string; ticket: TicketJson }): Promise<z.infer<typeof HandoverConfirmResponse>>
  reportNoShow(user: number, body: { buyerId: string; lotId: string; tokenAmount: string }): Promise<z.infer<typeof NoShowReportResponse>>
  contestNoShow(user: number, session: string, body: { sellerId: string; lotId: string; buyer: string; photos: PhotoBody[] }): Promise<z.infer<typeof DisputeResponse>>
  dispute(user: number, body: { buyerId: string; lotId: string; tokenAmount: string; photos: PhotoBody[] }): Promise<z.infer<typeof DisputeResponse>>
}

export type AgentsClientOptions = { baseUrl: string; serviceToken: string; fetch?: typeof fetch; timeoutMs?: number; draftTimeoutMs?: number }

export function createAgentsClient(o: AgentsClientOptions): AgentsClient {
  const base = o.baseUrl.replace(/\/+$/, "")
  const f = o.fetch ?? fetch
  const timeoutMs = o.timeoutMs ?? 15_000 // a walk-in waits for minting and gas on chain
  const draftTimeoutMs = o.draftTimeoutMs ?? 60_000 // drafts: parsing plus photo grading; confirms: the lot on chain

  async function call<T>(user: number, method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: object, session?: string, ms = timeoutMs): Promise<T> {
    let res: Response
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: {
          [BOT_TOKEN_HEADER]: o.serviceToken,
          [BOT_USER_HEADER]: String(user),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(session ? { authorization: `Bearer ${session}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(ms),
      })
    } catch (e) {
      const timedOut = (e as { name?: string })?.name === "TimeoutError"
      throw new AgentsError(0, timedOut ? "timeout" : "unreachable", "The market service is not answering")
    }
    const json: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      const err = ErrorBody.safeParse(json)
      throw err.success ? new AgentsError(res.status, err.data.error.code, err.data.error.message) : new AgentsError(res.status, `http_${res.status}`, `The market service answered HTTP ${res.status}`)
    }
    const ok = schema.safeParse(json)
    if (!ok.success) throw new AgentsError(res.status, "bad_response", "Unexpected reply from the market service")
    return ok.data
  }

  const seg = (s: string) => encodeURIComponent(s)
  return {
    sellerSession: (user, sellerId, pin) => call(user, "POST", "/api/sessions/seller", SellerSession, { sellerId, pin }),
    seller: (user, sellerId) => call(user, "GET", `/api/sellers/${seg(sellerId)}`, SellerInfo),
    agent: (user, agentId) => call(user, "GET", `/api/agents/${seg(agentId)}`, AgentView),
    walkin: (user, name, currency) => call(user, "POST", "/api/walkin", WalkinResponse, { name, currency }),
    draft: (user, session, body) => call(user, "POST", "/api/listings/draft", DraftView, body, session, draftTimeoutMs),
    confirm: (user, body) => call(user, "POST", "/api/listings/confirm", ConfirmResponse, body, undefined, draftTimeoutMs), // waits for the lot on chain
    sellerProfile: (user, sellerId) => call(user, "GET", `/api/sellers/${seg(sellerId)}`, SellerProfile),
    advice: (user, sellerId) => call(user, "GET", `/api/sellers/${seg(sellerId)}/advice`, AdviceResponse),
    lot: (user, lotId) => call(user, "GET", `/api/lots/${seg(lotId)}`, LotInfo),
    timeline: (user, lotId) => call(user, "GET", `/api/lots/${seg(lotId)}/timeline`, TimelineResponse),
    // Chain writes wait as long as a confirm: the transaction has to land.
    bid: (user, body) => call(user, "POST", "/api/walkin/bid", BidResponse, body, undefined, draftTimeoutMs),
    ticket: (user, session, body) => call(user, "POST", "/api/handover/ticket", HandoverTicketResponse, body, session, draftTimeoutMs),
    confirmHandover: (user, body) => call(user, "POST", "/api/handover/confirm", HandoverConfirmResponse, body, undefined, draftTimeoutMs),
    reportNoShow: (user, body) => call(user, "POST", "/api/noshow/report", NoShowReportResponse, body, undefined, draftTimeoutMs),
    contestNoShow: (user, session, body) => call(user, "POST", "/api/noshow/contest", DisputeResponse, body, session, draftTimeoutMs),
    dispute: (user, body) => call(user, "POST", "/api/disputes", DisputeResponse, body, undefined, draftTimeoutMs),
  }
}
