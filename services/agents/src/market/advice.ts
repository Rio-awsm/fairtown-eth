import { type Commodity, type Currency, type Persona, type Sector } from "@fairtown/shared"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import { formatUnits, type Address } from "viem"
import type { ArkivStore } from "../arkiv/ArkivStore"
import type { ChainAdapter, ProtocolParams } from "../chain/types"
import { SECTOR_OF } from "../listing/catalog"
import { suggestFloor } from "../listing/floor"
import { findReference, type ReferenceRow } from "../listing/references"
import type { MarketState } from "./state"

export type AdviceDeps = {
  arkiv: Pick<ArkivStore, "query">
  chain: Pick<ChainAdapter, "sellerRecord" | "advanceBpsFor" | "blockNumber">
  references: ReferenceRow[]
  market?: MarketState
  params: Pick<ProtocolParams, "provenAfter" | "advanceNewBps" | "advanceProvenBps">
}

const DEFAULT_COMMODITY: Record<Sector, Commodity> = { fish: "cod", flowers: "marigold", produce: "tomato", truck: "truck_capacity", storage: "storage_slot", compute: "gpu_hour" }
const sym = (c: Currency) => (c === "EUR" ? "€" : "$")
const cents = (v: bigint) => {
  const [i, f = ""] = formatUnits(v, 6).split(".")
  return `${i}.${(f + "00").slice(0, 2)}`
}
const median = (xs: bigint[]) => {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n
}

export function commodityFor(p: Persona, asked?: string): Commodity {
  if (asked && asked in SECTOR_OF) return asked as Commodity
  const sector = p.sectors[0]!
  if (sector === "flowers" && p.place === "nairobi") return "rose"
  return DEFAULT_COMMODITY[sector]
}

// Grounded seller advice: every number in the text comes from `basis` (Arkiv clears and reputation, reference, signals).
export async function sellerAdvice(d: AdviceDeps, seller: { address: Address; persona: Persona }, asked?: string) {
  const p = seller.persona
  const commodity = commodityFor(p, asked)
  const sector = SECTOR_OF[commodity]
  const place = p.place
  const currency = p.currency
  const c = sym(currency)

  const ref = findReference(d.references, commodity, place)
  const reference = ref && ref.currency === currency ? ref : undefined

  let clears: Array<{ lotId: string; finalClearingPerUnit: string; avgPerUnit: string; soldUnits: string; day: string }> = []
  let arkivOk = true
  try {
    const page = await d.arkiv.query(ARKIV_SCHEMAS.price, { commodity, place, currency }, { limit: 10, orderBy: { field: "lotId", dir: "desc" } })
    clears = page.entities.map((e) => ({
      lotId: String(e.values.lotId),
      finalClearingPerUnit: String(e.values.finalClearingPerUnit),
      avgPerUnit: String(e.values.avgPerUnit),
      soldUnits: String(e.values.soldUnits),
      day: String(e.values.day),
    }))
  } catch {
    arkivOk = false
  }

  // Reputation: latest Arkiv record if there is one; the chain stays the truth for the payout tier.
  let reputation: { source: "arkiv" | "chain"; cleanLots: number; noShows: number; proven: boolean }
  const chainRec = await d.chain.sellerRecord(seller.address)
  try {
    const page = await d.arkiv.query(ARKIV_SCHEMAS.reputation, { seller: seller.address }, { limit: 50 })
    const latest = page.entities.sort((a, b) => Number(BigInt(b.values.cleanLots as bigint) + BigInt(b.values.noShows as bigint)) - Number(BigInt(a.values.cleanLots as bigint) + BigInt(a.values.noShows as bigint)))[0]
    reputation = latest
      ? { source: "arkiv", cleanLots: Number(latest.values.cleanLots), noShows: Number(latest.values.noShows), proven: chainRec.proven }
      : { source: "chain", ...chainRec }
  } catch {
    arkivOk = false
    reputation = { source: "chain", ...chainRec }
  }

  const block = await d.chain.blockNumber()
  const signals = d.market?.signalsFor(place, sector, block) ?? []
  const advanceBps = await d.chain.advanceBpsFor(seller.address, sector)
  const recent = clears.map((x) => BigInt(x.finalClearingPerUnit)).reverse()
  const floor = suggestFloor({ ...(reference ? { reference: BigInt(reference.perUnit) } : {}), recent, grade: "na" })
  const med = recent.length ? median(recent) : undefined

  const lines: string[] = []
  if (med !== undefined && reference) {
    const vs = med > BigInt(reference.perUnit) ? "above" : med < BigInt(reference.perUnit) ? "below" : "at"
    lines.push(`${commodity} at ${place} cleared a median ${c}${cents(med)} over the last ${recent.length} lots, ${vs} the ${c}${cents(BigInt(reference.perUnit))} reference.`)
  } else if (med !== undefined) lines.push(`${commodity} at ${place} cleared a median ${c}${cents(med)} over the last ${recent.length} lots.`)
  else if (reference) lines.push(`No ${commodity} sales at ${place} on the ledger yet; the reference is ${c}${cents(BigInt(reference.perUnit))} (${reference.source}, ${reference.date}).`)
  else lines.push(`No sales or reference for ${commodity} at ${place} yet, so set the floor from your own costs.`)
  if (floor) lines.push(`A floor near ${c}${cents(floor.floorPerUnit)} should sell.`)
  if (signals.length) lines.push(`${signals.map((s) => s.label).join("; ")}: buyers are ${signals.some((s) => s.kind === "demand_dip") ? "holding back, so list early" : "keen, so don't go lower"}.`)
  const nowPct = advanceBps / 100
  if (reputation.proven) lines.push(`You're proven: ${nowPct}% at sale, the rest at handover.`)
  else {
    const left = Math.max(0, d.params.provenAfter - reputation.cleanLots)
    lines.push(`You're new: ${nowPct}% at sale, the rest at handover.${reputation.noShows === 0 && left > 0 ? ` ${left} more clean ${left === 1 ? "lot makes" : "lots make"} you proven (${d.params.advanceProvenBps / 100}% at sale).` : ""}`)
  }
  if (reputation.noShows > 0) lines.push(`Your record shows ${reputation.noShows} no-show${reputation.noShows > 1 ? "s" : ""}; some buyer agents skip you until it clears.`)

  return {
    advice: lines.join(" "),
    basis: {
      commodity,
      place,
      currency,
      reference: reference ? { perUnit: reference.perUnit, source: reference.source, date: reference.date, sourceUrl: reference.sourceUrl } : null,
      recentClears: clears,
      medianClear: med?.toString() ?? null,
      suggestedFloor: floor ? { perUnit: floor.floorPerUnit.toString(), basis: floor.basis } : null,
      signals: signals.map((s) => ({ kind: s.kind, place: s.place, severity: s.severity, label: s.label, expiresAtBlock: s.expiresAtBlock.toString() })),
      reputation,
      advanceBps,
      arkiv: arkivOk ? "ok" : "unavailable, chain record used",
    },
  }
}
