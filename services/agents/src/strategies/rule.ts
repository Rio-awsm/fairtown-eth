import type { Decision, Observation, Strategy } from "../runtime/types"

const fmt = (v: bigint, cur: string) => `${cur === "EUR" ? "€" : "$"}${(Number(v) / 1e6).toFixed(2)}`
const STEP_TICKS = 3n

// Deterministic fallback and default: step up a few ticks above clearing, never past the mandate max.
export const ruleStrategy: Strategy = {
  name: "rule",
  decide(o: Observation): Decision {
    const { agent, lot } = o
    const m = agent.mandate
    if (!m) return { action: "pass", reason: "No mandate set" }
    if (!m.commodities.includes(lot.commodity as (typeof m.commodities)[number])) return { action: "pass", reason: `${lot.commodity} isn't on my list` }
    if (lot.sellerRecord.noShows > 0 && m.avoidNoShowSellers !== false)
      return { action: "pass", reason: `${lot.sellerName ?? "Seller"} has a recent no-show`.slice(0, 80) }
    const max = BigInt(m.maxPerUnit)
    const min = lot.clearingPerUnit + lot.tickPerUnit
    if (min > max) return { action: "pass", reason: `Clearing ${fmt(lot.clearingPerUnit, lot.currency)} is above my max` }
    if (o.myBestOnLot > lot.clearingPerUnit) return { action: "pass", reason: "Still winning at my last bid" }
    const step = lot.clearingPerUnit + lot.tickPerUnit * STEP_TICKS
    const price = step < max ? step : max
    const want = m.qty ? BigInt(m.qty) : lot.qty
    const amount = want * price
    const why = o.myBestOnLot > 0n ? "Outbid, stepping up" : `${lot.commodity} ${lot.grade}`
    return { action: "bid", maxPerUnit: price.toString(), amount: amount.toString(), moveTo: lot.building, reason: `${why}, bidding ${fmt(price, lot.currency)}`.slice(0, 80) }
  },
}
