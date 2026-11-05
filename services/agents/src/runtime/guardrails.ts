import { GRADES } from "@fairtown/shared"
import type { Decision, Observation } from "./types"

export type GuardrailConfig = {
  perAuctionBps: bigint // share of budget one auction may hold
  maxBidsPerMinute: number
}
export const DEFAULT_GUARDRAILS: GuardrailConfig = { perAuctionBps: 6000n, maxBidsPerMinute: 6 }

export type GuardOk = { ok: true; maxPerUnit: bigint; amount: bigint; clamped: string[] }
export type GuardNo = { ok: false; reason: string }

// Grades in the same sector, best first; the shared GRADES list is ordered best to worst within each family.
const rank = (g: string) => GRADES.indexOf(g as (typeof GRADES)[number])
const FAMILY: Record<string, string> = {
  extra: "p", class_1: "p", class_2: "p", fresh_e: "f", fresh_a: "f", fresh_b: "f", unfit: "f", bloom_a: "b", bloom_b: "b",
}

// No bid reaches the chain without passing here. LLM output is advice.
export function checkBid(d: Decision, o: Observation, recentBidTimes: number[], now: number, cfg: GuardrailConfig = DEFAULT_GUARDRAILS): GuardOk | GuardNo {
  const { agent, lot } = o
  const m = agent.mandate
  if (d.action !== "bid") return { ok: false, reason: `not a bid (${d.action})` }
  if (agent.paused) return { ok: false, reason: "agent paused" }
  if (!m) return { ok: false, reason: "no mandate" }
  if (!["BUYER", "SOCIETY", "HUMAN"].includes(agent.role)) return { ok: false, reason: `role ${agent.role} cannot bid` }
  if (lot.currency !== agent.currency) return { ok: false, reason: `lot is ${lot.currency}, budget is ${agent.currency}` }
  if (!m.commodities.includes(lot.commodity as (typeof m.commodities)[number])) return { ok: false, reason: `${lot.commodity} not in mandate` }
  if (m.place && m.place !== lot.place) return { ok: false, reason: `place ${lot.place} outside mandate` }
  if (m.minGrade && FAMILY[m.minGrade] && FAMILY[m.minGrade] === FAMILY[lot.grade] && rank(lot.grade) > rank(m.minGrade))
    return { ok: false, reason: `grade ${lot.grade} below ${m.minGrade}` }
  if (lot.sellerRecord.noShows > 0 && m.avoidNoShowSellers !== false) return { ok: false, reason: "seller has a recent no-show" }
  if (lot.blocksLeft <= 0n) return { ok: false, reason: "auction ended" }
  if (!d.maxPerUnit || !d.amount) return { ok: false, reason: "bid without price or amount" }

  const clamped: string[] = []
  const mandateMax = BigInt(m.maxPerUnit)
  let price = BigInt(d.maxPerUnit)
  if (price > mandateMax) {
    price = mandateMax
    clamped.push("price clamped to mandate max")
  }
  const minPrice = lot.clearingPerUnit + lot.tickPerUnit
  if (price < minPrice) return { ok: false, reason: "price not a tick above clearing" }

  const perAuctionCap = (agent.budget * cfg.perAuctionBps) / 10000n - o.exposureOnLot
  let amount = BigInt(d.amount)
  const cap = perAuctionCap < o.budgetLeft ? perAuctionCap : o.budgetLeft
  if (amount > cap) {
    amount = cap
    clamped.push("amount clamped to budget and exposure cap")
  }
  if (amount < price) return { ok: false, reason: "budget or exposure cap too small for one unit" }

  const windowStart = now - 60_000
  if (recentBidTimes.filter((t) => t > windowStart).length >= cfg.maxBidsPerMinute) return { ok: false, reason: "rate limit" }
  return { ok: true, maxPerUnit: price, amount, clamped }
}
