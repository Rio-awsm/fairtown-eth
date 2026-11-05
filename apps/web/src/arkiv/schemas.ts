import { defineSchema, str, u256, u64 } from "@arkiv-network/sdk/schema"

/**
 * Arkiv schemas the browser reads (contract 10, source of truth 9.2), namespace `fairtown.v1.`.
 * Temporary: mirrors contract 10 until S2 2.1 ships `@fairtown/shared/arkiv`; then import those.
 */
export const PriceSchema = defineSchema("fairtown.v1.price", {
  sector: str().indexed(),
  commodity: str().indexed(),
  grade: str().indexed(),
  market: str().indexed(),
  place: str().indexed(),
  currency: str().indexed(),
  lotId: u256().indexed(),
  finalClearingPerUnit: u256().indexed(),
  avgPerUnit: u256().indexed(),
  soldUnits: u256().indexed(),
  day: u64().indexed(),
  tx: str(),
})

export const ReputationSchema = defineSchema("fairtown.v1.reputation", {
  seller: str().indexed(),
  tier: str().indexed(),
  cleanLots: u64().indexed(),
  noShows: u64().indexed(),
  day: u64().indexed(),
  lastLotId: u256().optional(),
  tx: str().optional(),
})

export const SCHEMAS = { price: PriceSchema, reputation: ReputationSchema } as const
