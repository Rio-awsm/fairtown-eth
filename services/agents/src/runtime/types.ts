import { BUILDINGS, type Building, type Currency, type Grade, type Persona, type Place, type Role, type Sector } from "@fairtown/shared"
import type { Mandate } from "@fairtown/shared/api"
import type { Address } from "viem"
import { z } from "zod"

// Source of truth section 11. LLM and rule strategies both return this; guardrails decide what reaches the chain.
export const Decision = z.object({
  action: z.enum(["bid", "pass", "list", "relist", "move", "handover", "report_no_show"]),
  maxPerUnit: z.string().regex(/^\d+$/).optional(),
  amount: z.string().regex(/^\d+$/).optional(),
  moveTo: z.enum(BUILDINGS).optional(),
  reason: z.string().max(80),
})
export type Decision = z.infer<typeof Decision>

export type MandateT = z.infer<typeof Mandate>

export type RuntimeAgent = {
  agentId: Address
  name: string
  role: Role
  kind: Persona["kind"] | "custom"
  building: Building
  sprite: string
  currency: Currency
  budget: bigint
  mandate?: MandateT
  paused: boolean
  walletIndex: number
  personaId?: string
  manual?: boolean // walk-in humans: never auto-bid, only through manualBid
  owner?: `tg:${string}` // created through the Telegram bot (ICR-012): only that Telegram user may act for this agent
}

export type LotObservation = {
  lotId: bigint
  auction: Address
  sector: Sector
  commodity: string
  grade: Grade
  building: Building
  place: Place
  seller: Address
  sellerName?: string
  sellerRecord: { cleanLots: number; noShows: number; proven: boolean }
  currency: Currency
  qty: bigint
  floorPerUnit: bigint
  clearingPerUnit: bigint
  tickPerUnit: bigint
  endBlock: bigint
  blocksLeft: bigint
  reference?: bigint
  sellerEns?: { name: string; verified: boolean } // ADDON_ENS: resolved through ENS before bidding
}

export type MarketSignal = { kind: string; place: string; severity: number; label: string }
// Live inputs from SignalOracle (S2 5.3): urgency 10000 = normal, above means step up harder, below means hold back.
export type MarketView = { signals: MarketSignal[]; urgencyBps: number }

export type Observation = {
  agent: RuntimeAgent
  budgetLeft: bigint
  exposureOnLot: bigint
  myBestOnLot: bigint
  lot: LotObservation
  market?: MarketView
}

// parallel: all agents on a lot decide at once (LLM latency), then bids execute in order. Rules stay sequential,
// so each agent sees the clearing the previous bid moved.
export type Strategy = { name: string; parallel?: boolean; decide(o: Observation): Decision | Promise<Decision> }
