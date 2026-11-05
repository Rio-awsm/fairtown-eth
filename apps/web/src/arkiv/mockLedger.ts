import type { TownEnvelope } from "@fairtown/shared/protocol"
import type { TownState } from "../game/reducer"

/** Rows as the board reads them: indexed numbers as bigint, text as string. */
export type PriceRow = {
  $key: string
  sector: string
  commodity: string
  grade: string
  market: string
  place: string
  currency: string
  lotId: bigint
  finalClearingPerUnit: bigint
  avgPerUnit: bigint
  soldUnits: bigint
  day: bigint
  tx: string
}
export type ReputationRow = {
  $key: string
  seller: string
  tier: string
  cleanLots: bigint
  noShows: bigint
  day: bigint
}
export type Ledger = { price: PriceRow[]; reputation: ReputationRow[] }

export const emptyLedger = (): Ledger => ({ price: [], reputation: [] })

const DAY_MS = 86_400_000
const keyOf = (id: string) =>
  `0x${[...new TextEncoder().encode(id)].map((b) => b.toString(16).padStart(2, "0")).join("")}`

/**
 * MOCK LEDGER: what S2's writer puts on Arkiv, built from the relay by contract 10's rules. A
 * `price` once per `lot.settled`, a new `reputation` per `seller.record`. `town` is the state
 * before the envelope, for the lot's listing data.
 */
export function appendLedger(ledger: Ledger, town: TownState, envelope: TownEnvelope): Ledger {
  const e = envelope.event
  const day = BigInt(Math.floor(envelope.ts / DAY_MS))
  if (e.type === "lot.settled") {
    const lot = town.lots[e.lotId]
    if (!lot) return ledger
    const row: PriceRow = {
      $key: keyOf(envelope.id),
      sector: lot.sector,
      commodity: lot.commodity,
      grade: lot.grade,
      market: lot.building,
      place: lot.place,
      currency: lot.currency,
      lotId: BigInt(e.lotId),
      finalClearingPerUnit: BigInt(e.finalClearingPerUnit),
      avgPerUnit: BigInt(e.avgPerUnit),
      soldUnits: BigInt(e.soldUnits),
      day,
      tx: e.tx,
    }
    return { ...ledger, price: [...ledger.price, row] }
  }
  if (e.type === "seller.record") {
    const row: ReputationRow = {
      $key: keyOf(envelope.id),
      seller: e.seller.toLowerCase(),
      tier: e.proven ? "proven" : "new",
      cleanLots: BigInt(e.cleanLots),
      noShows: BigInt(e.noShows),
      day,
    }
    return { ...ledger, reputation: [...ledger.reputation, row] }
  }
  return ledger
}
