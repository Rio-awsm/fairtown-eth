import type { Currency } from "@fairtown/shared/keys"
import { floorToTick, fromQ96, tickFor, toQ96 } from "@fairtown/shared/units"
import { parseUnits } from "viem"
import { formatMoney } from "../money/format"

/** Walk-in bidding (S3 3.2): prices snap to CCA ticks, strictly above clearing (contract 5). */

/** Demo walk-in budget, 100.00 in the lot's currency, until the walk-in API returns one (NOTES). */
export const DEFAULT_BUDGET = 100_000_000n
const MIN_AMOUNT = 1_000_000n
/** How many ticks the price slider offers above the first valid one. */
export const SLIDER_STEPS = 60

export type TickPlan = { tickQ96: bigint; firstQ96: bigint }

/** Tick size from the floor, and the first tick strictly above clearing (or the floor before any bids). */
export function tickPlan(floorPerUnit: bigint, clearingPerUnit?: bigint): TickPlan {
  const tickQ96 = tickFor(toQ96(floorPerUnit))
  const baseQ96 = toQ96(clearingPerUnit ?? floorPerUnit)
  return { tickQ96, firstQ96: floorToTick(baseQ96, tickQ96) + tickQ96 }
}

/** The Q96 price at a slider step: always on a tick, always above clearing. */
export const priceAt = (plan: TickPlan, step: number): bigint => plan.firstQ96 + BigInt(step) * plan.tickQ96

/**
 * The per-unit price to send. Rounding down from the tick means the API's `ceilToTick(toQ96(…))`
 * lands back on exactly this tick (tested for many floors and prices).
 */
export const apiMaxPerUnit = (q: bigint): bigint => fromQ96(q)

export type AmountCheck = { ok: true; value: bigint } | { ok: false; error: string }

/** How much the walk-in spends: at least 1.00 and within the budget. */
export function checkAmount(input: string, budget: bigint, currency: Currency): AmountCheck {
  const text = input.trim().replace(",", ".")
  if (text === "") return { ok: false, error: "Enter how much to spend" }
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return { ok: false, error: "Enter an amount like 20" }
  const value = parseUnits(text, 6)
  if (value < MIN_AMOUNT) return { ok: false, error: `Spend at least ${formatMoney(MIN_AMOUNT, currency)}` }
  if (value > budget) return { ok: false, error: `You can spend up to ${formatMoney(budget, currency)}` }
  return { ok: true, value }
}

/** Whole units the amount buys at most, at this price per unit. */
export const maxUnits = (amount: bigint, perUnit: bigint): bigint => (perUnit > 0n ? amount / perUnit : 0n)
