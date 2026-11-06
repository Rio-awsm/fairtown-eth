import type { Address, Hex } from "viem"
import { randomUUID } from "node:crypto"
import type { AiTrace } from "../ai/providers"
import type { GradeReport } from "./grade"
import type { ParsedListing } from "./parse"
import type { StoredPhoto } from "./photos"
import type { ReferenceRow } from "./references"

export type Draft = {
  draftId: string
  sellerId: string
  seller: Address
  text: string
  transcript?: string
  parsed: ParsedListing
  grade: GradeReport
  gradeSource: "vision" | "fixed" | "unavailable"
  trace?: AiTrace
  photos: StoredPhoto[]
  photoFlags: string[]
  reference?: ReferenceRow
  suggestedFloorPerUnit: bigint
  floorBasis: string[]
  advanceBps: number
  tier: "new" | "proven" | "truck"
  createdAt: string
  owner?: `tg:${string}` // drafted through the Telegram bot (ICR-012): only that Telegram user may confirm it
  confirmed?: { lotId: bigint; tx: Hex; floorPerUnit: bigint; durationBlocks: number }
}

export type DisputeRecord = { disputeId: string; lotId: bigint; kind: "quality" | "no_show"; handoverPhotos: StoredPhoto[] }

export class DraftStore {
  private readonly drafts = new Map<string, Draft>()
  private readonly lotToDraft = new Map<string, string>()
  private readonly disputes = new Map<string, DisputeRecord>()

  create(d: Omit<Draft, "draftId" | "createdAt">, now = new Date()): Draft {
    const draft: Draft = { ...d, draftId: `d_${randomUUID().replace(/-/g, "").slice(0, 12)}`, createdAt: now.toISOString() }
    this.drafts.set(draft.draftId, draft)
    return draft
  }
  get(draftId: string) {
    return this.drafts.get(draftId)
  }
  confirm(draftId: string, c: NonNullable<Draft["confirmed"]>) {
    const d = this.drafts.get(draftId)
    if (!d) return
    d.confirmed = c
    this.lotToDraft.set(c.lotId.toString(), draftId)
  }
  byLot(lotId: bigint | string) {
    const id = this.lotToDraft.get(lotId.toString())
    return id ? this.drafts.get(id) : undefined
  }
  bySeller(sellerId: string) {
    return [...this.drafts.values()].filter((d) => d.sellerId === sellerId && d.confirmed)
  }
  photo(hash: string) {
    for (const d of this.drafts.values()) for (const p of d.photos) if (p.hash === hash) return p
    for (const r of this.disputes.values()) for (const p of r.handoverPhotos) if (p.hash === hash) return p
    return undefined
  }
  addDispute(r: DisputeRecord) {
    this.disputes.set(r.disputeId, r)
  }
  dispute(id: string) {
    return this.disputes.get(id)
  }
}
