import { z } from "zod"
import { TicketJson } from "./handover"
import {
  BUILDINGS,
  COMMODITIES,
  CURRENCIES,
  DISPLAY_CURRENCIES,
  GRADES,
  LOT_STATUS,
  PLACES,
  ROLE_NAMES,
  SECTORS,
} from "./keys"
import { Dec } from "./units"

const zSector = z.enum(SECTORS)
const zCommodity = z.enum(COMMODITIES)
const zPlace = z.enum(PLACES)
const zCurrency = z.enum(CURRENCIES)
const zGrade = z.enum(GRADES)
const zRole = z.enum(ROLE_NAMES)
const Tx = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

export const SCENARIOS = [
  "bergen_cod",
  "dallas_return",
  "gpu_night",
  "diwali_marigold",
  "rose_flight",
  "lagos_cold",
  "no_show",
  "full_day",
] as const

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) })

const DepStatus = z.object({ ok: z.boolean(), detail: z.string().optional() })
export const HealthResponse = z.object({
  ok: z.boolean(),
  chain: DepStatus,
  arkiv: DepStatus,
  ai: DepStatus,
  addons: z.record(z.string(), DepStatus),
})

export const Photo = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  lotCode: z.string().regex(/^\d{4}$/),
  gps: z.object({ lat: z.number(), lon: z.number() }).optional(),
  capturedAt: z.iso.datetime({ offset: true }),
})

export const DraftRequest = z
  .object({
    sellerId: z.string(),
    text: z.string().min(1).optional(),
    audioBase64: z.string().optional(),
    photos: z.array(Photo).max(3).optional(),
  })
  .refine((r) => r.text !== undefined || r.audioBase64 !== undefined, { message: "text or audioBase64 is required" })

export const ReferenceResponse = z.object({
  perUnit: Dec,
  currency: z.string(),
  date: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
})

export const LotDraft = z.object({
  draftId: z.string(),
  sector: zSector,
  commodity: zCommodity,
  qty: Dec,
  unit: z.string(),
  place: zPlace,
  market: z.enum(BUILDINGS),
  currency: zCurrency,
  grade: zGrade,
  gradeReport: z.object({ grade: zGrade, defects: z.array(z.string()), confidence: z.number().min(0).max(1) }),
  trace: z.looseObject({}).optional(),
  suggestedFloorPerUnit: Dec,
  reference: ReferenceResponse.optional(),
  display: z.looseObject({ currency: z.enum(DISPLAY_CURRENCIES) }).optional(),
  payoutPreview: z.object({
    advanceBps: z.number().int().min(0).max(10000),
    tier: z.enum(["new", "proven", "truck"]),
  }),
  transcript: z.string().optional(),
})

export const ConfirmRequest = z.object({
  draftId: z.string(),
  floorPerUnit: Dec,
  durationBlocks: z.number().int().positive(),
})
export const ConfirmResponse = z.object({ lotId: Dec, auction: Addr, token: Addr, tx: Tx })

export const LotView = z.looseObject({
  spec: z.unknown(),
  status: z.enum(LOT_STATUS),
  clearing: Dec.optional(),
  avg: Dec.optional(),
  bids: z.array(z.unknown()),
  settlement: z.unknown().optional(),
})
export const TimelineResponse = z.object({
  steps: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      block: z.number().int().optional(),
      tx: Tx.optional(),
      deadlineBlock: z.number().int().optional(),
    }),
  ),
})
export const SellerProfile = z.looseObject({
  tier: z.enum(["new", "proven"]),
  lots: z.array(z.unknown()),
  payouts: z.array(z.unknown()),
})
export const AdviceResponse = z.object({ advice: z.string(), basis: z.unknown() })

export const Mandate = z.object({
  commodities: z.array(zCommodity).min(1),
  maxPerUnit: Dec,
  qty: Dec.optional(),
  minGrade: zGrade.optional(),
  place: zPlace.optional(),
  avoidNoShowSellers: z.boolean().default(true),
})
export const CreateBuyerRequest = z.object({
  name: z.string().min(1),
  role: zRole,
  currency: zCurrency,
  mandate: Mandate,
  budget: Dec,
})
export const CreateBuyerResponse = z.object({ agentId: z.string(), address: Addr })
export const AgentView = z.looseObject({ agentId: z.string(), name: z.string(), role: zRole })
export const PatchAgentRequest = z.object({ mandate: Mandate.partial().optional(), paused: z.boolean().optional() })

export const WalkinRequest = z.object({ name: z.string().min(1).max(32), currency: zCurrency.optional() })
export const WalkinResponse = z.object({ agentId: z.string(), address: Addr, token: z.string() })
export const WalkinBidRequest = z.object({ token: z.string(), lotId: Dec, maxPerUnit: Dec, amount: Dec })
export const BidResponse = z.object({ bidId: Dec, tx: Tx })

export const HandoverTicketRequest = z.object({ sellerId: z.string(), lotId: Dec, buyer: Addr, tokenAmount: Dec })
export const HandoverTicketResponse = z.object({ ticket: TicketJson, qrText: z.string(), fallbackUrl: z.string() })
export const HandoverConfirmRequest = z.object({ receiverId: z.string(), ticket: TicketJson })
export const HandoverConfirmResponse = z.object({ tx: Tx, releasedToSeller: Dec })

export const NoShowReportRequest = z.object({ buyerId: z.string(), lotId: Dec, tokenAmount: Dec })
export const NoShowReportResponse = z.object({ tx: Tx, contestEnds: z.number().int() })
export const NoShowContestRequest = z.object({
  sellerId: z.string(),
  lotId: Dec,
  buyer: Addr,
  photos: z.array(Photo).min(1),
})
export const DisputeRequest = z.object({
  buyerId: z.string(),
  lotId: Dec,
  tokenAmount: Dec,
  photos: z.array(Photo).min(1),
})
export const DisputeResponse = z.object({ disputeId: Dec, tx: Tx })
export const DisputeEvidence = z.object({
  lotId: Dec,
  kind: z.enum(["quality", "no_show"]),
  listingPhotos: z.array(z.string()),
  handoverPhotos: z.array(z.string()),
  rubric: z.string(),
  grade: zGrade,
})

export const SttRequest = z.object({ audioBase64: z.string(), language: z.string() })
export const SttResponse = z.object({ text: z.string(), provider: z.string() })
export const CalendarResponse = z.object({
  events: z.array(
    z.object({
      name: z.string(),
      date: z.string(),
      market: z.string(),
      sectorsAffected: z.array(zSector),
      demandMultiplier: z.number(),
      source: z.string(),
    }),
  ),
})
export const FxResponse = z.object({
  base: z.string(),
  rates: z.record(z.string(), z.number()),
  date: z.string(),
  source: z.string(),
})
export const DirectorScenarioRequest = z.object({ name: z.enum(SCENARIOS), speed: z.number().positive().optional() })
export const DirectorScenarioResponse = z.object({ started: z.boolean() })
export const DirectorStatus = z.looseObject({ scenario: z.string().nullable(), step: z.string().nullable() })
