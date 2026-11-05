import type { Building, Commodity, Currency, Place, Sector } from "@fairtown/shared"
import { z } from "zod"
import type { AiGateway } from "../ai/gateway"
import { COMMODITY_WORDS, CURRENCY_OF_PLACE, marketOf, PLACE_WORDS, SECTOR_OF, toCanonicalQty, unitOf, unitPattern } from "./catalog"

export type ParsedListing = {
  sector: Sector
  commodity: Commodity
  qty: bigint
  unit: string
  place: Place
  market: Building
  currency: Currency
  readyBy?: string
  source: "llm" | "rules"
}

// What the LLM is asked for: words as the seller said them. Code maps and converts.
export const RawListing = z.object({
  commodity: z.string().describe("the product in the seller's words, e.g. 'skrei', 'tomatoes', 'truck space', 'GPU hours'"),
  quantity: z.number().describe("the number as stated, before any unit conversion"),
  unit: z.string().describe("the unit as stated, e.g. 'kg', 'tonnes', 'quintal', 'lb', 'GPU hours', 'slot-days'; empty if none"),
  place: z.string().describe("the origin town or market as stated; empty if none"),
  readyBy: z.string().optional().describe("ready time as stated, if any"),
})
export type RawListing = z.infer<typeof RawListing>

const SYSTEM =
  "You read short messages from sellers in a market for perishable goods, transport space, storage and GPU hours. " +
  "Extract the fields exactly as the seller wrote them. Never convert units. If a route like 'A to B' is given, place is A."

const firstMatch = <T>(text: string, table: Array<[RegExp, T]>): T | undefined => {
  let best: { at: number; value: T } | undefined
  for (const [re, value] of table) {
    const m = text.match(re)
    if (m && m.index !== undefined && (best === undefined || m.index < best.at)) best = { at: m.index, value }
  }
  return best?.value
}

export function normalize(raw: RawListing, fullText: string, source: ParsedListing["source"], homePlace?: Place): ParsedListing | null {
  const commodity = firstMatch(raw.commodity, COMMODITY_WORDS) ?? (source === "rules" ? firstMatch(fullText, COMMODITY_WORDS) : undefined)
  if (!commodity) return null
  const sector = SECTOR_OF[commodity]
  const qty = toCanonicalQty(raw.quantity, raw.unit, sector)
  if (qty === null) return null
  const place = firstMatch(raw.place, PLACE_WORDS) ?? firstMatch(fullText, PLACE_WORDS) ?? (sector === "compute" ? "any_dc" : homePlace)
  if (!place) return null
  return {
    sector,
    commodity,
    qty,
    unit: unitOf(sector),
    place,
    market: marketOf(sector),
    currency: CURRENCY_OF_PLACE[place],
    ...(raw.readyBy ? { readyBy: raw.readyBy } : {}),
    source,
  }
}

const QTY = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${unitPattern})?\\b`, "i")

// Deterministic fallback when the model is down or wrong.
export function parseWithRules(text: string, homePlace?: Place): ParsedListing | null {
  const m = text.match(QTY)
  if (!m) return null
  return normalize({ commodity: text, quantity: Number(m[1]!.replace(/,/g, "")), unit: m[2] ?? "", place: text }, text, "rules", homePlace)
}

// homePlace: the seller's usual place, used only when the message names none.
export async function parseListing(text: string, ai: Pick<AiGateway, "decide">, homePlace?: Place): Promise<ParsedListing | null> {
  try {
    const { value } = await ai.decide("listing", { system: SYSTEM, prompt: text, schema: RawListing })
    const parsed = normalize(value, text, "llm", homePlace)
    if (parsed) return parsed
  } catch {
    // LLM output is advice; rules decide below.
  }
  return parseWithRules(text, homePlace)
}
