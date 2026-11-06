import { UNITS } from "@fairtown/shared"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import { createHash } from "node:crypto"
import { formatUnits, parseUnits } from "viem"
import { z } from "zod"
import { AiError, type AiGateway } from "../ai/gateway"
import type { ArkivStore } from "../arkiv/ArkivStore"
import { PERSONAS } from "../fixtures/personas"
import { findReference, type ReferenceRow } from "../listing/references"
import { Decision, type LotObservation, type Observation, type RuntimeAgent, type Strategy } from "../runtime/types"
import { ruleStrategy } from "./rule"

// What the model returns: display units, because models are bad at 6-decimal integers. Code converts to Decision.
// Plain schema (no transforms) so the gateway can also send it as JSON Schema text.
export const BidAdvice = z.object({
  action: z.enum(["bid", "pass"]),
  maxPerUnit: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional()
    .describe("Highest price per unit you will pay, decimal, e.g. 9.40. Required when bidding."),
  qty: z.string().regex(/^\d+$/).optional().describe("Whole units to buy. Defaults to your mandate quantity."),
  reason: z.string().min(1).max(200).describe("Under 80 characters, first person, plain words."),
})
export type BidAdvice = z.infer<typeof BidAdvice>

export type Signal = { kind: string; place: string; severity: number; label: string }
export type MarketContext = { reference?: bigint; recentClears: bigint[]; signals: Signal[] }
export type ContextFn = (lot: LotObservation) => MarketContext | Promise<MarketContext>

export type LlmStats = {
  decisions: number
  hardRule: number
  cached: number
  llm: number
  firstTry: number
  fallbacks: Record<"timeout" | "invalid_output" | "provider_error" | "rate_limited" | "mock_error" | "unusable", number>
  ms: number[]
}

export type LlmStrategyOptions = {
  ai: Pick<AiGateway, "decide">
  context?: ContextFn
  bioOf?: (agent: RuntimeAgent) => string | undefined
  cacheBlocks?: bigint // D-64
  blockMs?: number
  timeoutMs?: number
  onFallback?: (code: string, agent: RuntimeAgent) => void
}

const WORD_LIMIT = 150
const money = (v: bigint) => formatUnits(v, 6)
const sym = (c: string) => (c === "EUR" ? "€" : "$")
const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 80)

const STYLE: Record<string, string> = {
  buyer: "Stay patient early and step up as the clock runs down. Good grade and a short clock justify paying near the reference; a weak grade does not.",
  society: "You buy for families. Value beats speed: bid near the floor and let others chase.",
  custom: "Pay a fair price near the reference and avoid bidding wars.",
}

export function personaPrompt(agent: RuntimeAgent, bio?: string): string {
  const style = STYLE[agent.kind] ?? STYLE.custom
  return [
    `You are ${agent.name}, a buying agent in Fairtown, a live market for goods that expire.`,
    bio ?? "",
    "Each turn you see one auction and choose: bid or pass.",
    style,
    "Code checks every bid: above your mandate max, below one tick over clearing, or over budget gets clamped or dropped.",
    'Reply with JSON only: action, maxPerUnit as a decimal like "9.40", qty in whole units, reason.',
    "The reason is a speech bubble: under 80 characters, first person, with the currency symbol.",
    "Name the one fact that decided it: grade, seller record, time left, a signal, or clearing against reference.",
  ]
    .filter(Boolean)
    .join(" ")
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

// Everything the model sees. Built only from public market state: no keys, no mnemonic, no wallet internals.
export function observationText(o: Observation, ctx: MarketContext, blockMs = 200): string {
  const { agent, lot } = o
  const m = agent.mandate!
  const c = sym(lot.currency)
  const unit = UNITS[lot.sector]
  const ref = lot.reference ?? ctx.reference
  const rec = lot.sellerRecord
  const tier = rec.proven ? "proven" : "new"
  const secs = Math.round((Number(lot.blocksLeft) * blockMs) / 1000)
  const prices = [
    `floor ${money(lot.floorPerUnit)}`,
    `clearing ${money(lot.clearingPerUnit)}`,
    `tick ${money(lot.tickPerUnit)}`,
    ref !== undefined ? `reference ${money(ref)}` : "reference unknown",
    ctx.recentClears.length ? `recent clears ${ctx.recentClears.slice(0, 5).map(money).join(", ")}` : "no recent clears",
  ]
  const signals = ctx.signals.length ? ctx.signals.map((s) => `${s.label} (${s.kind}, ${s.place}, severity ${s.severity})`).join("; ") : "none"
  return [
    `Me: budget left ${c}${money(o.budgetLeft)}, already committed on this lot ${c}${money(o.exposureOnLot)}, my best bid ${o.myBestOnLot > 0n ? `${c}${money(o.myBestOnLot)}` : "none"}.`,
    `Mandate: ${m.commodities.join(", ")}; max ${c}${money(BigInt(m.maxPerUnit))}/${unit}; want ${m.qty ?? lot.qty.toString()} ${unit}${m.minGrade ? `; min grade ${m.minGrade}` : ""}.`,
    `Lot ${lot.lotId}: ${lot.qty} ${unit} ${lot.commodity}, grade ${lot.grade}, ${lot.place}, seller ${lot.sellerName ?? "unknown"} (${tier}: ${rec.cleanLots} clean lots, ${rec.noShows} no-shows).`,
    `Prices in ${lot.currency} (${c}) per ${unit}: ${prices.join(", ")}.`,
    `Signals: ${signals}.`,
    `Time left: ${lot.blocksLeft} blocks (about ${secs} s).`,
  ].join("\n")
}

// Advice to a Decision in base units. Returns null when the advice can't be used (rules then decide).
export function toDecision(a: BidAdvice, o: Observation): Decision | null {
  const reason = short(a.reason)
  if (!reason) return null
  if (a.action === "pass") return { action: "pass", reason }
  if (!a.maxPerUnit) return null
  const { lot, agent } = o
  let price = parseUnits(a.maxPerUnit, 6)
  const min = lot.clearingPerUnit + lot.tickPerUnit
  if (price < min) price = min // the model meant "bid": lift to the lowest valid price; guardrails still cap at mandate max
  let qty = a.qty ? BigInt(a.qty) : agent.mandate?.qty ? BigInt(agent.mandate.qty) : lot.qty
  if (qty > lot.qty) qty = lot.qty
  if (qty <= 0n) return null
  const d = Decision.safeParse({ action: "bid", maxPerUnit: price.toString(), amount: (qty * price).toString(), moveTo: lot.building, reason })
  return d.success ? d.data : null
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v)

export function cacheKey(o: Observation, ctx: MarketContext): string {
  const { agent, lot } = o
  const body = {
    a: agent.agentId,
    m: agent.mandate,
    b: o.budgetLeft,
    e: o.exposureOnLot,
    best: o.myBestOnLot,
    lot: lot.lotId,
    clr: lot.clearingPerUnit,
    rec: lot.sellerRecord,
    ref: lot.reference ?? ctx.reference,
    rc: ctx.recentClears.slice(0, 5),
    s: ctx.signals,
    t: lot.blocksLeft / 50n, // urgency bucket
  }
  return createHash("sha256").update(JSON.stringify(body, replacer)).digest("hex")
}

const emptyStats = (): LlmStats => ({
  decisions: 0,
  hardRule: 0,
  cached: 0,
  llm: 0,
  firstTry: 0,
  fallbacks: { timeout: 0, invalid_output: 0, provider_error: 0, rate_limited: 0, mock_error: 0, unusable: 0 },
  ms: [],
})

const defaultBio = (a: RuntimeAgent) => PERSONAS.find((p) => p.id === a.personaId)?.bio

// LLM advises inside the rules: hard passes (no mandate, off-list, no-show seller, over max, still winning) never reach
// the model, and any timeout, invalid or unusable answer falls back to the rule strategy. Guardrails run after either.
export function createLlmStrategy(opts: LlmStrategyOptions): Strategy & { stats: () => LlmStats } {
  const cacheBlocks = opts.cacheBlocks ?? 10n
  const bioOf = opts.bioOf ?? defaultBio
  const cache = new Map<string, { d: Decision; block: bigint }>()
  const stats = emptyStats()

  const fallback = (o: Observation, code: keyof LlmStats["fallbacks"]) => {
    stats.fallbacks[code]++
    opts.onFallback?.(code, o.agent)
    return ruleStrategy.decide(o) as Decision
  }

  return {
    name: "llm",
    parallel: true,
    stats: () => structuredClone(stats),
    async decide(o: Observation): Promise<Decision> {
      stats.decisions++
      const rule = ruleStrategy.decide(o) as Decision
      if (rule.action === "pass") {
        stats.hardRule++
        return rule
      }
      const base = (await opts.context?.(o.lot)) ?? { recentClears: [], signals: [] }
      const ctx = o.market ? { ...base, signals: o.market.signals } : base
      const block = o.lot.endBlock - o.lot.blocksLeft
      const key = cacheKey(o, ctx)
      const hit = cache.get(key)
      if (hit && block - hit.block < cacheBlocks) {
        stats.cached++
        return hit.d
      }
      stats.llm++
      let d: Decision | null
      try {
        const r = await opts.ai.decide("bidder", {
          system: personaPrompt(o.agent, bioOf(o.agent)),
          prompt: observationText(o, ctx, opts.blockMs),
          schema: BidAdvice,
          ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        })
        stats.ms.push(r.ms)
        d = toDecision(r.value, o)
        if (d && r.attempt === 1) stats.firstTry++
      } catch (e) {
        return fallback(o, e instanceof AiError ? e.code : "provider_error")
      }
      if (!d) return fallback(o, "unusable")
      if (cache.size > 2000) for (const [k, v] of cache) if (block - v.block >= cacheBlocks) cache.delete(k)
      cache.set(key, { d, block })
      return d
    },
  }
}

// Reference from references.json (same currency only) and the last clears for this commodity and place from Arkiv
// price entities. Clears are cached for 30 s so a busy tick doesn't hammer Rabdi.
export function marketContext(deps: { references: ReferenceRow[]; arkiv?: Pick<ArkivStore, "query">; signals?: () => Signal[]; now?: () => number }): ContextFn {
  const now = deps.now ?? Date.now
  const clears = new Map<string, { at: number; v: bigint[] }>()
  return async (lot) => {
    const r = findReference(deps.references, lot.commodity, lot.place)
    const reference = r && r.currency === lot.currency ? BigInt(r.perUnit) : undefined
    const k = `${lot.commodity}:${lot.place}:${lot.currency}`
    let c = clears.get(k)
    if (deps.arkiv && (!c || now() - c.at > 30_000)) {
      try {
        const page = await deps.arkiv.query(
          ARKIV_SCHEMAS.price,
          { commodity: lot.commodity, place: lot.place, currency: lot.currency },
          { limit: 10, orderBy: { field: "lotId", dir: "desc" } },
        )
        c = { at: now(), v: page.entities.map((e) => BigInt(e.values.finalClearingPerUnit as bigint | string)) }
        clears.set(k, c)
      } catch {
        // Arkiv down: decide without recent clears rather than stall the tick.
      }
    }
    const signals = (deps.signals?.() ?? []).filter((s) => s.place === lot.place || s.place === "any")
    return { ...(reference !== undefined ? { reference } : {}), recentClears: c?.v ?? [], signals }
  }
}
