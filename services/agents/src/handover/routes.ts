import { encodeTicket, fromTicketJson, toTicketJson } from "@fairtown/shared"
import {
  DisputeResponse,
  HandoverConfirmRequest,
  HandoverConfirmResponse,
  HandoverTicketRequest,
  HandoverTicketResponse,
  NoShowContestRequest,
  NoShowReportRequest,
  NoShowReportResponse,
} from "@fairtown/shared/api"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { concat, keccak256, type Address } from "viem"
import { z } from "zod"
import { assertOwner, caller } from "../callers"
import { ChainError } from "../chain/errors"
import type { ChainAdapter } from "../chain/types"
import type { DraftStore } from "../listing/drafts"
import { HttpError, jsonSafe, parse } from "../listing/routes"
import type { PhotoStore } from "../listing/photos"
import type { AgentRuntime } from "../runtime/runtime"
import type { Wallets } from "../runtime/wallets"
import type { SellerDirectory } from "../sellers"
import { bearer, RateLimiter, samePin, SESSION_MS, type SessionStore } from "./sessions"
import { issueTicket } from "./tickets"

export type HandoverDeps = {
  chain: ChainAdapter
  wallets: Pick<Wallets, "queue">
  runtime: AgentRuntime
  sellers: SellerDirectory
  sessions: SessionStore
  photos: PhotoStore
  drafts: DraftStore
  config: { SELLER_PIN?: string; PUBLIC_WEB_URL: string; PUBLIC_BASE_URL: string }
  ticketValidBlocks: bigint // about 5 minutes
  now?: () => number
}

const SellerSessionRequest = z.object({ sellerId: z.string(), pin: z.string() })

// Chain reverts become 409 with the contract's error name; a missing lot is 404.
export async function onChain<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof ChainError) throw new HttpError(e.code === "LotNotFound" ? 404 : 409, e.code, e.message)
    throw e
  }
}

export function registerHandoverRoutes(app: FastifyInstance, d: HandoverDeps) {
  const pinTries = new RateLimiter(10, 10 * 60_000, Number.MAX_SAFE_INTEGER, d.now)

  const agentOf = (id: string) => {
    const a = [...d.runtime.agents.values()].find((x) => x.agentId === id.toLowerCase() || x.personaId === id)
    if (!a) throw new HttpError(404, "unknown_agent", `No agent ${id}`)
    return a
  }
  // The seller's key signs only inside that seller's session.
  const sellerSession = (req: FastifyRequest, sellerId: string) => {
    const s = d.sessions.get(bearer(req.headers.authorization), "seller")
    if (!s) throw new HttpError(401, "no_session", "Sign in as the seller first")
    if (s.subject !== sellerId) throw new HttpError(403, "wrong_seller", "This session belongs to another seller")
    const seller = d.sellers.get(sellerId)
    if (!seller) throw new HttpError(404, "unknown_seller", `No seller ${sellerId}`)
    return seller
  }

  app.post("/api/sessions/seller", async (req) => {
    if (!d.config.SELLER_PIN) throw new HttpError(503, "sessions_disabled", "Seller sessions need SELLER_PIN")
    const body = parse(SellerSessionRequest, req.body)
    // Keyed per Telegram user for bot calls, else per IP: one bot user guessing PINs never locks out the others.
    if (!pinTries.take(caller(req).rateKey).ok) throw new HttpError(429, "rate_limited", "Too many tries, wait a few minutes")
    const seller = d.sellers.get(body.sellerId)
    if (!seller || !["SELLER", "TRUCK", "STORAGE"].includes(seller.role)) throw new HttpError(404, "unknown_seller", `No seller ${body.sellerId}`)
    if (!samePin(body.pin, d.config.SELLER_PIN)) throw new HttpError(401, "bad_pin", "Wrong PIN")
    const s = d.sessions.create("seller", seller.id, SESSION_MS)
    return { token: s.token, sellerId: seller.id, expiresAt: new Date(s.expiresAt).toISOString() }
  })

  app.post("/api/handover/ticket", async (req) => {
    const body = parse(HandoverTicketRequest, req.body)
    const seller = sellerSession(req, body.sellerId)
    const lotId = BigInt(body.lotId)
    const buyer = body.buyer.toLowerCase() as Address
    const tokenAmount = BigInt(body.tokenAmount)
    if (tokenAmount === 0n) throw new HttpError(400, "bad_request", "tokenAmount must be above zero")
    const lot = await onChain(() => d.chain.getLot(lotId))
    if (lot.spec.seller.toLowerCase() !== seller.address) throw new HttpError(403, "not_your_lot", `Lot ${lotId} belongs to another seller`)
    if (!lot.settlement || lot.settlement.heldRemaining === 0n) throw new HttpError(409, "nothing_held", `Lot ${lotId} has nothing left to hand over`)
    if ((await d.chain.tokenBalance(lotId, buyer)) < tokenAmount) throw new HttpError(409, "insufficient_tokens", "That buyer doesn't hold this much of the lot")
    const ticket = await onChain(() => issueTicket(d.chain, seller.address, { lotId, buyer, tokenAmount }, d.ticketValidBlocks))
    const qrText = encodeTicket(ticket)
    // Fragment, not query: the ticket never reaches a server log.
    const fallbackUrl = `${d.config.PUBLIC_WEB_URL.replace(/\/+$/, "")}/scan#t=${Buffer.from(qrText).toString("base64url")}`
    return HandoverTicketResponse.parse({ ticket: toTicketJson(ticket), qrText, fallbackUrl })
  })

  // Sent from the receiver's wallet (buyer or assigned carrier); the contract checks signature, sender, expiry and reuse.
  app.post("/api/handover/confirm", async (req) => {
    const body = parse(HandoverConfirmRequest, req.body)
    const receiver = agentOf(body.receiverId)
    assertOwner(receiver.owner, caller(req), "agent")
    const ticket = fromTicketJson(body.ticket)
    if (ticket.expiryBlock < (await d.chain.blockNumber())) throw new HttpError(409, "TicketExpired", "This handover code has expired; ask the seller for a new one")
    const r = await onChain(() => d.wallets.queue(receiver.agentId, () => d.chain.confirmHandover(receiver.agentId, ticket)))
    return HandoverConfirmResponse.parse({ tx: r.tx, releasedToSeller: r.releasedToSeller.toString() })
  })

  app.post("/api/noshow/report", async (req) => {
    const body = parse(NoShowReportRequest, req.body)
    const buyer = agentOf(body.buyerId)
    assertOwner(buyer.owner, caller(req), "agent")
    const r = await onChain(() => d.wallets.queue(buyer.agentId, () => d.chain.reportNoShow(buyer.agentId, BigInt(body.lotId), BigInt(body.tokenAmount))))
    return NoShowReportResponse.parse({ tx: r.tx, contestEnds: Number(r.contestEnds) })
  })

  app.post("/api/noshow/contest", async (req) => {
    const body = parse(NoShowContestRequest, req.body)
    const seller = sellerSession(req, body.sellerId)
    const lotId = BigInt(body.lotId)
    const checked = d.photos.check(body.photos)
    if (!checked.photos.length) throw new HttpError(400, "bad_photos", "No usable photos")
    const evidenceHash = keccak256(concat(checked.photos.map((p) => p.hash)))
    const evidenceURI = `${d.config.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/disputes/{disputeId}/evidence`
    const buyer = body.buyer.toLowerCase() as Address
    const r = await onChain(() => d.wallets.queue(seller.address, () => d.chain.contestNoShow(seller.address, lotId, buyer, evidenceHash, evidenceURI)))
    d.drafts.addDispute({ disputeId: r.disputeId.toString(), lotId, kind: "no_show", handoverPhotos: checked.photos })
    return DisputeResponse.parse(jsonSafe({ disputeId: r.disputeId, tx: r.tx }))
  })
}
