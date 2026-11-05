import { ConfirmRequest, ConfirmResponse, DisputeEvidence, DraftRequest, LotDraft, LotView, SellerProfile, TimelineResponse } from "@fairtown/shared/api"
import type { LotStatus } from "@fairtown/shared"
import type { FastifyInstance } from "fastify"
import { createReadStream, existsSync } from "node:fs"
import type { z } from "zod"
import type { AiGateway } from "../ai/gateway"
import type { ChainAdapter, LotState } from "../chain/types"
import { pickupWindowFor, type AgentsConfig } from "../config"
import type { SellerDirectory } from "../sellers"
import { RUBRIC } from "./catalog"
import type { Draft, DraftStore } from "./drafts"
import { suggestFloor } from "./floor"
import { gradeLot } from "./grade"
import { parseListing } from "./parse"
import type { PhotoStore } from "./photos"
import { findReference, toResponse, type ReferenceRow } from "./references"

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type ListingDeps = {
  config: AgentsConfig & { PUBLIC_BASE_URL: string }
  ai: Pick<AiGateway, "decide" | "transcribe">
  chain: ChainAdapter
  sellers: SellerDirectory
  photos: PhotoStore
  drafts: DraftStore
  references: ReferenceRow[]
  recentPrices?: (commodity: string, place: string) => Promise<bigint[]>
}

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body)
  if (!r.success) {
    const i = r.error.issues[0]!
    throw new HttpError(400, "bad_request", `${i.path.join(".") || "body"}: ${i.message}`)
  }
  return r.data
}

// bigint values travel as decimal strings.
export const jsonSafe = (v: unknown): unknown =>
  typeof v === "bigint"
    ? v.toString()
    : Array.isArray(v)
      ? v.map(jsonSafe)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]))
        : v

const photoUrl = (base: string, hash: string) => `${base}/api/photos/${hash}`

export function draftView(d: Draft) {
  const defects = [...d.grade.defects, ...d.photoFlags.map((f) => `Photo check: ${f}`)]
  return LotDraft.parse({
    draftId: d.draftId,
    sector: d.parsed.sector,
    commodity: d.parsed.commodity,
    qty: d.parsed.qty.toString(),
    unit: d.parsed.unit,
    place: d.parsed.place,
    market: d.parsed.market,
    currency: d.parsed.currency,
    grade: d.grade.grade,
    gradeReport: { grade: d.grade.grade, defects, confidence: d.grade.confidence },
    ...(d.trace ? { trace: d.trace } : {}),
    suggestedFloorPerUnit: d.suggestedFloorPerUnit.toString(),
    ...(d.reference ? { reference: toResponse(d.reference) } : {}),
    payoutPreview: { advanceBps: d.advanceBps, tier: d.tier },
    ...(d.transcript ? { transcript: d.transcript } : {}),
  })
}

export function lotMetadata(d: Draft, base: string) {
  return {
    name: `${d.parsed.qty} ${d.parsed.unit} ${d.parsed.commodity}, ${d.parsed.place}`,
    description: d.text,
    draftId: d.draftId,
    seller: d.seller,
    sellerId: d.sellerId,
    sector: d.parsed.sector,
    commodity: d.parsed.commodity,
    qty: d.parsed.qty.toString(),
    unit: d.parsed.unit,
    place: d.parsed.place,
    currency: d.parsed.currency,
    grade: d.grade.grade,
    gradeReport: { ...d.grade, source: d.gradeSource, note: "AI opinion, not a certificate" },
    photoChecks: d.photoFlags,
    photos: d.photos.map((p) => ({
      hash: p.hash,
      url: photoUrl(base, p.hash),
      lotCode: p.lotCode,
      capturedAt: p.capturedAt,
      ...(p.gps ? { gps: p.gps } : {}),
    })),
    ...(d.trace ? { trace: { requestId: d.trace.requestId, provider: d.trace.provider, teeVerified: d.trace.teeVerified } } : {}),
    createdAt: d.createdAt,
  }
}

const DONE: Record<string, LotStatus[]> = {
  sold: ["sold", "truck_booked", "picked_up", "delivered", "paid_in_full", "no_show_reported", "disputed", "refunded"],
  truck: ["truck_booked", "picked_up", "delivered", "paid_in_full"],
  picked: ["picked_up", "delivered", "paid_in_full"],
  delivered: ["delivered", "paid_in_full"],
  paid: ["paid_in_full"],
}

export function timeline(lot: LotState, block: bigint) {
  const st = lot.status
  const s = lot.settlement
  const step = (name: string, done: boolean, extra: { block?: bigint; deadlineBlock?: bigint } = {}, current = false) => ({
    name,
    status: done ? "done" : current ? "current" : "pending",
    ...(extra.block !== undefined ? { block: Number(extra.block) } : {}),
    ...(extra.deadlineBlock !== undefined ? { deadlineBlock: Number(extra.deadlineBlock) } : {}),
  })
  const steps = [step("Listed", true, { block: lot.startBlock })]
  if (st === "unsold" || st === "relisted") steps.push({ name: st === "unsold" ? "Unsold" : "Relisted", status: "done", block: Number(lot.endBlock) })
  else steps.push(step("Sold", DONE.sold!.includes(st), { deadlineBlock: lot.endBlock }, st === "open"))
  if (s && s.soldUnits > 0n && ["produce", "fish", "flowers"].includes(lot.spec.sector)) steps.push(step("Truck booked", DONE.truck!.includes(st) || s.carrier !== undefined))
  if (s && s.soldUnits > 0n) {
    const pickupLate = block > s.pickupDeadline && !DONE.picked!.includes(st)
    steps.push(step("Picked up", DONE.picked!.includes(st), { deadlineBlock: s.pickupDeadline }, !pickupLate && DONE.sold!.includes(st)))
    steps.push(step("Delivered", DONE.delivered!.includes(st)))
    steps.push(step("Paid in full", DONE.paid!.includes(st)))
  }
  if (st === "no_show_reported" || st === "disputed" || st === "refunded") {
    const name = { no_show_reported: "No-show reported", disputed: "Disputed", refunded: "Refunded" }[st]
    steps.push({ name, status: "done" })
  }
  return TimelineResponse.parse({ steps })
}

export function registerListingRoutes(app: FastifyInstance, deps: ListingDeps) {
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/+$/, "")

  app.post("/api/listings/draft", async (req) => {
    const body = parse(DraftRequest, req.body)
    const seller = deps.sellers.get(body.sellerId)
    if (!seller) throw new HttpError(404, "unknown_seller", `No seller ${body.sellerId}`)
    let text = body.text
    let transcript: string | undefined
    if (!text) {
      try {
        transcript = (await deps.ai.transcribe(body.audioBase64!)).text
        text = transcript
      } catch (e) {
        throw new HttpError(400, "stt_unavailable", (e as Error).message)
      }
    }
    const parsed = await parseListing(text, deps.ai, seller.persona.place)
    if (!parsed) throw new HttpError(422, "unreadable", "Couldn't read that. Try something like: 600 kg cod, Bergen")
    const photos = body.photos?.length ? deps.photos.check(body.photos) : { photos: [], flags: [] }
    const graded = await gradeLot(parsed.sector, parsed.commodity, photos.photos, deps.ai)
    const reference = findReference(deps.references, parsed.commodity, parsed.place)
    const recent = (await deps.recentPrices?.(parsed.commodity, parsed.place)) ?? []
    const floor = suggestFloor({ reference: reference ? BigInt(reference.perUnit) : undefined, recent, grade: graded.report.grade })
    const advanceBps = await deps.chain.advanceBpsFor(seller.address, parsed.sector)
    const tier = parsed.sector === "truck" ? "truck" : advanceBps >= deps.config.ADVANCE_PROVEN_BPS ? "proven" : "new"
    const draft = deps.drafts.create({
      sellerId: seller.id,
      seller: seller.address,
      text,
      ...(transcript ? { transcript } : {}),
      parsed,
      grade: graded.report,
      gradeSource: graded.source,
      ...(graded.trace ? { trace: graded.trace } : {}),
      photos: photos.photos,
      photoFlags: photos.flags,
      ...(reference ? { reference } : {}),
      suggestedFloorPerUnit: floor?.floorPerUnit ?? 1_000n,
      floorBasis: floor?.basis ?? ["No reference or recent clears; set your own floor"],
      advanceBps,
      tier,
    })
    return { ...draftView(draft), floorBasis: draft.floorBasis }
  })

  app.post("/api/listings/confirm", async (req) => {
    const body = parse(ConfirmRequest, req.body)
    const d = deps.drafts.get(body.draftId)
    if (!d) throw new HttpError(404, "unknown_draft", `No draft ${body.draftId}`)
    if (d.confirmed) throw new HttpError(409, "already_listed", `Draft ${d.draftId} is already lot ${d.confirmed.lotId}`)
    const floorPerUnit = BigInt(body.floorPerUnit)
    if (floorPerUnit < 1_000n) throw new HttpError(400, "floor_too_low", "Floor must be at least 0.001 per unit")
    const r = await deps.chain.createLot(d.seller, {
      sector: d.parsed.sector,
      market: d.parsed.market,
      commodity: d.parsed.commodity,
      grade: d.grade.grade,
      place: d.parsed.place,
      currency: d.parsed.currency,
      qty: d.parsed.qty,
      floorPerUnit,
      durationBlocks: BigInt(body.durationBlocks),
      pickupWindowBlocks: pickupWindowFor(deps.config, d.parsed.sector),
      parentLotId: 0n,
      seller: d.seller,
      metadataURI: `${base}/api/lots/meta/${d.draftId}`,
    })
    deps.drafts.confirm(d.draftId, { lotId: r.lotId, tx: r.tx, floorPerUnit, durationBlocks: body.durationBlocks })
    return ConfirmResponse.parse({ lotId: r.lotId.toString(), auction: r.auction, token: r.token, tx: r.tx })
  })

  app.get<{ Params: { draftId: string } }>("/api/lots/meta/:draftId", async (req) => {
    const d = deps.drafts.get(req.params.draftId)
    if (!d) throw new HttpError(404, "unknown_draft", `No draft ${req.params.draftId}`)
    return lotMetadata(d, base)
  })

  const lotOr404 = async (id: string) => {
    if (!/^\d+$/.test(id)) throw new HttpError(400, "bad_request", "lotId must be a number")
    try {
      return await deps.chain.getLot(BigInt(id))
    } catch {
      throw new HttpError(404, "unknown_lot", `No lot ${id}`)
    }
  }

  app.get<{ Params: { lotId: string } }>("/api/lots/:lotId", async (req) => {
    const lot = await lotOr404(req.params.lotId)
    const d = deps.drafts.byLot(lot.lotId)
    return LotView.parse(
      jsonSafe({
        lotId: lot.lotId,
        spec: lot.spec,
        status: lot.status,
        clearing: lot.clearingPerUnit,
        ...(lot.settlement ? { avg: lot.settlement.avgPerUnit, settlement: lot.settlement } : {}),
        bids: [],
        bidCount: lot.bidCount,
        auction: lot.auction,
        endBlock: lot.endBlock,
        ...(d ? { draftId: d.draftId, gradeReport: d.grade, metadataURI: `${base}/api/lots/meta/${d.draftId}` } : {}),
      }),
    )
  })

  app.get<{ Params: { lotId: string } }>("/api/lots/:lotId/timeline", async (req) => {
    const lot = await lotOr404(req.params.lotId)
    return timeline(lot, await deps.chain.blockNumber())
  })

  app.get<{ Params: { sellerId: string } }>("/api/sellers/:sellerId", async (req) => {
    const seller = deps.sellers.get(req.params.sellerId)
    if (!seller) throw new HttpError(404, "unknown_seller", `No seller ${req.params.sellerId}`)
    const record = await deps.chain.sellerRecord(seller.address)
    const lots = await Promise.all(deps.drafts.bySeller(seller.id).map((d) => deps.chain.getLot(d.confirmed!.lotId)))
    return SellerProfile.parse(
      jsonSafe({
        sellerId: seller.id,
        name: seller.name,
        address: seller.address,
        tier: record.proven ? "proven" : "new",
        record,
        lots: lots.map((l) => ({ lotId: l.lotId, commodity: l.spec.commodity, qty: l.spec.qty, status: l.status })),
        payouts: lots
          .filter((l) => l.settlement)
          .map((l) => ({
            lotId: l.lotId,
            currency: l.spec.currency,
            paidNow: l.settlement!.sellerPaid,
            held: l.settlement!.held,
            heldRemaining: l.settlement!.heldRemaining,
            refunded: l.settlement!.refunded,
          })),
      }),
    )
  })

  app.get<{ Params: { disputeId: string } }>("/api/disputes/:disputeId/evidence", async (req) => {
    const r = deps.drafts.dispute(req.params.disputeId)
    const d = r && deps.drafts.byLot(r.lotId)
    if (!r || !d) throw new HttpError(404, "unknown_dispute", `No dispute ${req.params.disputeId}`)
    return DisputeEvidence.parse({
      lotId: r.lotId.toString(),
      kind: r.kind,
      listingPhotos: d.photos.map((p) => photoUrl(base, p.hash)),
      handoverPhotos: r.handoverPhotos.map((p) => photoUrl(base, p.hash)),
      rubric: RUBRIC[d.parsed.sector],
      grade: d.grade.grade,
    })
  })

  app.get<{ Params: { hash: string } }>("/api/photos/:hash", async (req, reply) => {
    if (!/^0x[0-9a-f]{64}$/.test(req.params.hash)) throw new HttpError(400, "bad_request", "Bad photo hash")
    const p = deps.drafts.photo(req.params.hash)
    if (!p || !existsSync(p.file)) throw new HttpError(404, "unknown_photo", "No such photo")
    return reply.type(p.mediaType).send(createReadStream(p.file))
  })

  app.get<{ Querystring: { commodity?: string; market?: string } }>("/api/reference", async (req) => {
    const { commodity, market } = req.query
    if (!commodity || !market) throw new HttpError(400, "bad_request", "commodity and market are required")
    const r = findReference(deps.references, commodity, market)
    if (!r || r.commodity !== commodity) throw new HttpError(404, "no_reference", `No reference for ${commodity} at ${market}`)
    return toResponse(r)
  })
}
