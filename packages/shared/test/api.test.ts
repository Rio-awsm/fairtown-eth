import { describe, expect, it } from "vitest"
import {
  ApiError,
  ConfirmRequest,
  CreateBuyerRequest,
  DirectorScenarioRequest,
  DraftRequest,
  HandoverConfirmRequest,
  HandoverTicketResponse,
  LotDraft,
  SCENARIOS,
  WalkinBidRequest,
} from "../src/api"

const ticket = {
  lotId: "12",
  buyer: "0x00000000000000000000000000000000000000a1",
  tokenAmount: "600",
  expiryBlock: "1400",
  sig: "0x" + "11".repeat(65),
}
const photo = { dataUrl: "data:image/jpeg;base64,AA", lotCode: "4821", capturedAt: "2026-11-06T05:00:00Z" }

describe("api schemas", () => {
  it("error shape", () => {
    expect(ApiError.safeParse({ error: { code: "not_found", message: "No lot 9" } }).success).toBe(true)
    expect(ApiError.safeParse({ message: "No lot 9" }).success).toBe(false)
  })

  it("draft needs text or audio", () => {
    expect(DraftRequest.safeParse({ sellerId: "ingrid", text: "600 kg cod, Bergen" }).success).toBe(true)
    expect(DraftRequest.safeParse({ sellerId: "ingrid", audioBase64: "AAAA" }).success).toBe(true)
    expect(DraftRequest.safeParse({ sellerId: "ingrid" }).success).toBe(false)
  })

  it("photos: 4-digit lot code, ISO time with offset, at most 3", () => {
    const ok = (p: object[]) => DraftRequest.safeParse({ sellerId: "ingrid", text: "cod", photos: p }).success
    expect(ok([photo])).toBe(true)
    expect(ok([{ ...photo, capturedAt: "2026-11-06T10:30:00+05:30" }])).toBe(true)
    expect(ok([{ ...photo, lotCode: "48a1" }])).toBe(false)
    expect(ok([{ ...photo, capturedAt: "yesterday" }])).toBe(false)
    expect(ok([{ ...photo, dataUrl: "https://example.com/cod.jpg" }])).toBe(false)
    expect(ok([photo, photo, photo, photo])).toBe(false)
  })

  it("lot draft with payout preview", () => {
    const draft = {
      draftId: "d1",
      sector: "fish",
      commodity: "cod",
      qty: "600",
      unit: "kg",
      place: "bergen",
      market: "fish_dock",
      currency: "EUR",
      grade: "fresh_a",
      gradeReport: { grade: "fresh_a", defects: [], confidence: 0.86 },
      suggestedFloorPerUnit: "7500000",
      payoutPreview: { advanceBps: 5000, tier: "new" },
    }
    expect(LotDraft.parse(draft)).toEqual(draft)
    expect(LotDraft.safeParse({ ...draft, payoutPreview: { advanceBps: 12000, tier: "new" } }).success).toBe(false)
  })

  it("confirm rejects a float floor and zero duration", () => {
    expect(ConfirmRequest.safeParse({ draftId: "d1", floorPerUnit: "7500000", durationBlocks: 45 }).success).toBe(true)
    expect(ConfirmRequest.safeParse({ draftId: "d1", floorPerUnit: "7.5", durationBlocks: 45 }).success).toBe(false)
    expect(ConfirmRequest.safeParse({ draftId: "d1", floorPerUnit: "7500000", durationBlocks: 0 }).success).toBe(false)
  })

  it("buyer mandate defaults to avoiding no-show sellers", () => {
    const req = CreateBuyerRequest.parse({
      name: "Hanse Kitchen",
      role: "BUYER",
      currency: "EUR",
      budget: "20000000000",
      mandate: { commodities: ["cod"], maxPerUnit: "9400000" },
    })
    expect(req.mandate.avoidNoShowSellers).toBe(true)
  })

  it("walk-in bid amounts are base-unit strings", () => {
    const bid = { token: "t", lotId: "12", maxPerUnit: "9400000", amount: "50000000" }
    expect(WalkinBidRequest.safeParse(bid).success).toBe(true)
    expect(WalkinBidRequest.safeParse({ ...bid, maxPerUnit: 9.4 }).success).toBe(false)
  })

  it("director accepts only known scenarios", () => {
    for (const name of SCENARIOS) expect(DirectorScenarioRequest.safeParse({ name }).success).toBe(true)
    expect(DirectorScenarioRequest.safeParse({ name: "moon_landing" }).success).toBe(false)
  })

  it("handover ticket response and confirm reuse the ticket schema", () => {
    expect(HandoverTicketResponse.safeParse({ ticket, qrText: "{}", fallbackUrl: "https://x/scan?t=1" }).success).toBe(
      true,
    )
    expect(HandoverConfirmRequest.safeParse({ receiverId: "lars", ticket }).success).toBe(true)
    expect(HandoverConfirmRequest.safeParse({ receiverId: "lars", ticket: { ...ticket, sig: "0x12" } }).success).toBe(
      false,
    )
  })
})
