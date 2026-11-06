import { MARKET_OF_SECTOR, UNITS, type Commodity, type Currency, type Grade, type Place, type Sector } from "@fairtown/shared"

export const SECTOR_OF: Record<Commodity, Sector> = {
  cod: "fish",
  haddock: "fish",
  tomato: "produce",
  onion: "produce",
  marigold: "flowers",
  rose: "flowers",
  truck_capacity: "truck",
  cargo_slot: "truck",
  storage_slot: "storage",
  gpu_hour: "compute",
}

// Local and common words for each commodity, checked in order (longer phrases first).
export const COMMODITY_WORDS: Array<[RegExp, Commodity]> = [
  [/\bgenda\s*phool\b|\bmarigolds?\b|\bgenda\b/i, "marigold"],
  [/\bskrei\b|\bcod\b|\btorsk\b/i, "cod"],
  [/\bhaddock\b|\bhyse\b/i, "haddock"],
  [/\btomato(es)?\b|\btamatar\b/i, "tomato"],
  [/\bonions?\b|\bpyaz\b/i, "onion"],
  [/\broses?\b/i, "rose"],
  [/\bgpus?\b|\bh100s?\b|\ba100s?\b/i, "gpu_hour"],
  [/\bcold\s*(storage|room)\b|\bstorage\b|\bslot-?days?\b/i, "storage_slot"],
  [/\bcargo\b|\bair\s*freight\b/i, "cargo_slot"],
  [/\breefer\b|\btruck\b|\bspace\b|\bcapacity\b|\bempty\s*run\b/i, "truck_capacity"],
]

export const PLACE_WORDS: Array<[RegExp, Place]> = [
  [/\bbergen\b/i, "bergen"],
  [/\boslo\b/i, "oslo"],
  [/\bhamburg\b/i, "hamburg"],
  [/\bdallas\b/i, "dallas"],
  [/\bhouston\b/i, "houston"],
  [/\bmumbai\b|\bbombay\b|\bdadar\b/i, "mumbai"],
  [/\bpune\b/i, "pune"],
  [/\bnairobi\b|\bnaivasha\b/i, "nairobi"],
  [/\bamsterdam\b|\baalsmeer\b/i, "amsterdam"],
  [/\blagos\b|\bmile\s*12\b/i, "lagos"],
]

export const CURRENCY_OF_PLACE: Record<Place, Currency> = {
  bergen: "EUR",
  oslo: "EUR",
  hamburg: "EUR",
  amsterdam: "EUR",
  nairobi: "EUR",
  dallas: "USD",
  houston: "USD",
  mumbai: "USD",
  pune: "USD",
  lagos: "USD",
  any_dc: "USD",
}

// Factor to the sector's canonical unit, as a rational (num / den) so conversions stay exact until rounding.
const LB = { num: 45359237n, den: 100000000n }
const UNIT_WORDS: Array<[RegExp, { num: bigint; den: bigint }]> = [
  [/^(kg|kgs|kilo|kilos|kilograms?)$/i, { num: 1n, den: 1n }],
  [/^(t|ton|tons|tonne|tonnes|mt)$/i, { num: 1000n, den: 1n }],
  [/^(q|qtl|quintal|quintals)$/i, { num: 100n, den: 1n }],
  [/^(lb|lbs|pound|pounds)$/i, LB],
  [/^(gpu[\s-]?h(ou)?rs?|h(ou)?rs?|gpu[\s-]?hours?)$/i, { num: 1n, den: 1n }],
  [/^(slot-?days?|slots?|days?)$/i, { num: 1n, den: 1n }],
]

export const unitPattern =
  "kg|kgs|kilos?|kilograms?|tonnes?|tons?|t|mt|quintals?|qtl|q|lbs?|pounds?|gpu[\\s-]?h(?:ou)?rs?|h(?:ou)?rs?|slot-?days?|slots?"

// Quantity in the sector's whole unit; units are converted here, never by the LLM. Rounds half up.
export function toCanonicalQty(amount: string | number, unit: string | undefined, sector: Sector): bigint | null {
  const text = String(amount).replace(/,/g, "").trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const [whole, frac = ""] = text.split(".")
  const scale = 10n ** BigInt(frac.length)
  const value = BigInt(whole! + frac)
  const u = (unit ?? "").trim()
  const factor = u === "" ? { num: 1n, den: 1n } : UNIT_WORDS.find(([re]) => re.test(u))?.[1]
  if (!factor) return null
  if ((sector === "compute" || sector === "storage") && factor.num !== factor.den) return null
  const num = value * factor.num * 2n
  const den = scale * factor.den
  const qty = (num / den + 1n) / 2n
  return qty > 0n ? qty : null
}

export const marketOf = (sector: Sector) => MARKET_OF_SECTOR[sector]
export const unitOf = (sector: Sector) => UNITS[sector]

export const GRADES_FOR: Record<Sector, readonly Grade[]> = {
  fish: ["fresh_e", "fresh_a", "fresh_b", "unfit"],
  produce: ["extra", "class_1", "class_2"],
  flowers: ["bloom_a", "bloom_b"],
  compute: ["gpu_verified"],
  truck: ["na"],
  storage: ["na"],
}

export const RUBRIC: Record<Sector, string> = {
  fish: "EU freshness categories (Regulation 2406/96, FAO guide). fresh_e: convex eyes, black pupil, bright red gills, firm flesh. fresh_a: flat eyes, slightly opaque pupil, pink gills. fresh_b: slightly concave eyes, grey pupil, brown or grey gills. unfit: sunken milky eyes, slimy or discoloured flesh, off smell signs.",
  produce: "Class rubric. extra: no defects, uniform ripeness and size. class_1: slight defects in shape or colour, no rot. class_2: visible bruising or blemishes but sound and edible.",
  flowers: "Bloom rubric. bloom_a: correct bloom stage, straight firm stems, no wilt, even colour. bloom_b: uneven opening, some wilt or bent stems, faded colour.",
  compute: "Health check, not a photo: GPU model, memory and latency. Simulated in this demo.",
  truck: "No grading for transport capacity.",
  storage: "No grading for storage slots.",
}
