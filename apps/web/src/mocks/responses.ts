import type { z } from "zod"
import type { ApiRoutes, RouteKey } from "../net/routes"
import { MOCK_HANSE, MOCK_LOT12_UNITS, mockFallbackUrl, mockQrText, mockTicket } from "./ticket"

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`
const TX = `0x${"ab".repeat(32)}`
const HANSE = addr(0x102)

/** Mock bodies for every contract 11 route, Bergen cod values. Typed against the shared schemas. */
export const MOCK_RESPONSES: { [K in RouteKey]: z.input<ApiRoutes[K]["res"]> } = {
  health: {
    ok: true,
    chain: { ok: true, detail: "mock" },
    arkiv: { ok: true, detail: "mock" },
    ai: { ok: true, detail: "mock" },
    addons: {},
  },
  draftListing: {
    draftId: "draft-12",
    sector: "fish",
    commodity: "cod",
    qty: "600",
    unit: "kg",
    place: "bergen",
    market: "fish_dock",
    currency: "EUR",
    grade: "fresh_a",
    gradeReport: { grade: "fresh_a", defects: [], confidence: 0.92 },
    suggestedFloorPerUnit: "7500000",
    reference: {
      perUnit: "8300000",
      currency: "EUR",
      date: "2026-11-06",
      source: "mock",
      sourceUrl: "https://example.invalid/reference",
    },
    display: { currency: "NOK" },
    payoutPreview: { advanceBps: 5000, tier: "new" },
  },
  confirmListing: { lotId: "12", auction: addr(0xa00c), token: addr(0xb00c), tx: TX },
  lotMeta: { name: "Lot 12: 600 kg cod, Bergen", grade: "fresh_a" },
  lot: {
    spec: { commodity: "cod", qty: "600", unit: "kg" },
    status: "open",
    clearing: "8100000",
    bids: [],
    gradeReport: { grade: "fresh_a", defects: [], confidence: 0.92, standard: "EU fish freshness", tee_verified: true },
    winners: [{ buyer: MOCK_HANSE, tokenAmount: MOCK_LOT12_UNITS }],
  },
  lotTimeline: {
    steps: [
      { name: "Sold", status: "done", block: 1046, tx: TX },
      { name: "Truck booked", status: "done", block: 1060, tx: TX },
      { name: "Picked up", status: "pending", deadlineBlock: 1200 },
      { name: "Delivered", status: "pending" },
      { name: "Paid in full", status: "pending" },
    ],
  },
  seller: {
    sellerId: "ingrid",
    name: "Ingrid Solheim",
    tier: "new",
    lots: [{ lotId: "12", commodity: "cod", qty: "600", unit: "kg", status: "paid_in_full", currency: "EUR" }],
    payouts: [
      { lotId: "12", kind: "at_sale", amount: "2702700000", currency: "EUR", tx: TX },
      { lotId: "12", kind: "at_handover", amount: "2702700000", currency: "EUR", tx: TX },
    ],
  },
  sellerAdvice: {
    advice: "Storm tomorrow: list before 05:00 for more buyers.",
    basis: { storm: true, avgPerUnit: "9100000" },
  },
  createBuyer: { agentId: HANSE, address: HANSE },
  agents: [{ agentId: HANSE, name: "Hanse Kitchen", role: "BUYER" }],
  agent: {
    agentId: HANSE,
    name: "Hanse Kitchen",
    role: "BUYER",
    persona: "Hamburg restaurant group buying fresh fish",
    currency: "EUR",
    mandate: { commodities: ["cod", "haddock"], maxPerUnit: "9400000", minGrade: "fresh_a", avoidNoShowSellers: true },
    budget: "50000000000",
  },
  patchAgent: { agentId: HANSE, name: "Hanse Kitchen", role: "BUYER", paused: true },
  walkin: { agentId: addr(0x10f), address: addr(0x10f), token: "walkin-mock-session" },
  walkinBid: { bidId: "1", tx: TX },
  // Mock mode takes any PIN (the real API checks SELLER_PIN).
  sellerSession: { token: "mock-seller-session", sellerId: "ingrid", expiresAt: "2099-01-01T00:00:00.000Z" },
  handoverTicket: {
    ticket: mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS),
    qrText: mockQrText(mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS)),
    fallbackUrl: mockFallbackUrl(mockQrText(mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS))),
  },
  handoverConfirm: { tx: TX, releasedToSeller: "2702700000" },
  noshowReport: { tx: TX, contestEnds: 1500 },
  noshowContest: { disputeId: "8", tx: TX },
  openDispute: { disputeId: "7", tx: TX },
  disputeEvidence: {
    lotId: "50",
    kind: "quality",
    listingPhotos: [],
    handoverPhotos: [],
    rubric: "UNECE FFV-36 tomato class 1",
    grade: "class_1",
  },
  stt: { text: "600 kg cod, landed 04:40, Bergen", provider: "mock" },
  reference: {
    perUnit: "8300000",
    currency: "EUR",
    date: "2026-11-06",
    source: "mock",
    sourceUrl: "https://example.invalid/reference",
  },
  calendar: {
    events: [
      {
        name: "Lakshmi Puja",
        date: "2026-11-08",
        market: "flower_hall",
        sectorsAffected: ["flowers"],
        demandMultiplier: 1.8,
        source: "mock",
      },
    ],
  },
  fx: { base: "USD", rates: { EUR: 0.92, NOK: 10.83, INR: 84 }, date: "2026-11-06", source: "mock" },
  directorScenario: { started: true },
  directorStatus: { scenario: null, step: null },
}
