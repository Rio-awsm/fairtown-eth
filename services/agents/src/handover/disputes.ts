import { DisputeRequest, DisputeResponse } from "@fairtown/shared/api"
import type { FastifyInstance } from "fastify"
import { concat, keccak256, type Address } from "viem"
import type { ChainAdapter } from "../chain/types"
import type { DraftStore } from "../listing/drafts"
import { ChainError } from "../chain/errors"
import { HttpError, parse } from "../listing/routes"
import type { PhotoInput, PhotoStore } from "../listing/photos"
import type { AgentRuntime } from "../runtime/runtime"
import type { Wallets } from "../runtime/wallets"

export type DisputeDeps = {
  chain: ChainAdapter
  wallets: Pick<Wallets, "queue">
  photos: PhotoStore
  drafts: DraftStore
  baseUrl: string
}

// Quality dispute before handover: photos to disk, hash on chain, evidence served at /api/disputes/:id/evidence for CRE W3.
export async function fileDispute(d: DisputeDeps, buyer: Address, lotId: bigint, tokenAmount: bigint, photos: PhotoInput[]) {
  const checked = d.photos.check(photos)
  if (!checked.photos.length) throw new HttpError(400, "bad_photos", "No usable photos")
  const evidenceHash = keccak256(concat(checked.photos.map((p) => p.hash)))
  // CRE reads the dispute id from DisputeOpened and fills it in.
  const evidenceURI = `${d.baseUrl.replace(/\/+$/, "")}/api/disputes/{disputeId}/evidence`
  const r = await d.wallets.queue(buyer, () => d.chain.openDispute(buyer, lotId, tokenAmount, evidenceHash, evidenceURI))
  d.drafts.addDispute({ disputeId: r.disputeId.toString(), lotId, kind: "quality", handoverPhotos: checked.photos })
  return { disputeId: r.disputeId, tx: r.tx, flags: checked.flags }
}

export function registerDisputeRoutes(app: FastifyInstance, d: DisputeDeps & { runtime: AgentRuntime }) {
  app.post("/api/disputes", async (req) => {
    const body = parse(DisputeRequest, req.body)
    const buyer = [...d.runtime.agents.values()].find((a) => a.agentId === body.buyerId.toLowerCase() || a.personaId === body.buyerId)
    if (!buyer) throw new HttpError(404, "unknown_buyer", `Unknown buyer ${body.buyerId}`)
    let r: Awaited<ReturnType<typeof fileDispute>>
    try {
      r = await fileDispute(d, buyer.agentId, BigInt(body.lotId), BigInt(body.tokenAmount), body.photos)
    } catch (e) {
      if (e instanceof ChainError) throw new HttpError(409, e.code, e.message)
      throw e
    }
    return DisputeResponse.parse({ disputeId: r.disputeId.toString(), tx: r.tx })
  })
}

// Fixture evidence for the scripted dispute scene: a 1x1 PNG, unique per lot so it never trips the reuse check.
export function fixtureDisputePhotos(lotId: bigint): PhotoInput[] {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
  const tagged = Buffer.concat([png, Buffer.from(`fairtown-dispute-lot-${lotId}`)])
  return [{ dataUrl: `data:image/png;base64,${tagged.toString("base64")}`, lotCode: String(lotId % 10000n).padStart(4, "0"), capturedAt: new Date().toISOString() }]
}
