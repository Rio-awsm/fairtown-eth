import type { PriceRow } from "./mockLedger"

/**
 * Price weather (S3 4.1): a market's latest price against its own 30-day average, per commodity and
 * currency, so haddock is never judged against cod.
 */
export type Band = "much_lower" | "lower" | "normal" | "higher" | "much_higher"
export const BAND_COLOUR: Record<Band, number> = {
  much_lower: 0x2563eb,
  lower: 0x60a5fa,
  normal: 0x94a3b8,
  higher: 0xf59e0b,
  much_higher: 0xdc2626,
}
export const BAND_WORDS: Record<Band, string> = {
  much_lower: "Much cheaper than usual",
  lower: "Cheaper than usual",
  normal: "Usual price",
  higher: "Dearer than usual",
  much_higher: "Much dearer than usual",
}

/** ±5% and ±15% bands, in basis points with bigint maths. Exactly +5% is "higher"; exactly −5% "lower". */
export function weatherBand(latest: bigint, average: bigint): Band {
  if (average <= 0n) return "normal"
  const bps = ((latest - average) * 10_000n) / average
  if (bps <= -1500n) return "much_lower"
  if (bps <= -500n) return "lower"
  if (bps < 500n) return "normal"
  if (bps < 1500n) return "higher"
  return "much_higher"
}

export type MarketWeather = {
  market: string
  commodity: string
  currency: string
  latest: bigint
  average: bigint
  band: Band
  series: bigint[]
  /** The newest record's day and lot, so a building can follow its most recent commodity. */
  newest: { day: bigint; lotId: bigint }
}

/** Per market, commodity and currency over the last `windowDays` days up to `today`, with daily averages for a sparkline. */
export function marketWeather(rows: PriceRow[], today: bigint, windowDays = 30): MarketWeather[] {
  const groups = new Map<string, PriceRow[]>()
  for (const r of rows) {
    if (r.day <= today - BigInt(windowDays) || r.day > today) continue
    const key = `${r.market}|${r.commodity}|${r.currency}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.entries()].map(([key, rs]) => {
    const [market = "", commodity = "", currency = ""] = key.split("|")
    // Newest record: by day, then lot id (lot ids only grow), whatever order the rows arrive in.
    const newer = (a: PriceRow, b: PriceRow) => (b.day > a.day || (b.day === a.day && b.lotId > a.lotId) ? b : a)
    const newestRow = rs.reduce(newer)
    const latest = newestRow.avgPerUnit
    const average = rs.reduce((sum, r) => sum + r.avgPerUnit, 0n) / BigInt(rs.length)
    const byDay = new Map<bigint, bigint[]>()
    for (const r of rs) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r.avgPerUnit])
    const series = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, v]) => v.reduce((s, x) => s + x, 0n) / BigInt(v.length))
    return {
      market,
      commodity,
      currency,
      latest,
      average,
      band: weatherBand(latest, average),
      series,
      newest: { day: newestRow.day, lotId: newestRow.lotId },
    }
  })
}

/** SVG polyline points for a sparkline. Display only, so plain numbers are fine here. */
export function sparkPoints(values: bigint[], width: number, height: number): string {
  if (values.length === 0) return ""
  const nums = values.map(Number)
  if (nums.length === 1) return `0,${height / 2} ${width},${height / 2}`
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return nums
    .map((v, i) => {
      const x = (i * width) / (nums.length - 1)
      const y = max === min ? height / 2 : height - ((v - min) / (max - min)) * height
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`
    })
    .join(" ")
}
