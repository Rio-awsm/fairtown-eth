/**
 * W2 pure helpers (S1 4.3): Open-Meteo weather and a festival calendar become SignalOracle kind 2 demand signals
 * (contract 7.7). No CRE SDK imports. Rules: forced signals are always labelled "(forced)"; nothing is written without
 * a parsed value; every signal says where it came from in the logs.
 * Weather numbers (mm, km/h) are not money, so plain JS numbers are fine here.
 */
import { encodeAbiParameters, stringToHex, type Hex } from "viem"
import { z } from "zod"

/** ChainWrite.TargetsLimit from `cre workflow limits export` (CLI v1.39.0). */
export const MAX_WRITES_PER_RUN = 10
export const KIND_SIGNAL = 2
export const SIGNAL_KINDS = ["weather", "festival", "demand_dip", "reference"] as const // @fairtown/shared/keys
export const FORCED_SUFFIX = " (forced)"
export const MAX_LABEL = 64
const DATE = /^\d{4}-\d{2}-\d{2}$/
const KEY = /^[a-z0-9_]{1,32}$/
const HTTP_URL = /^https?:\/\/[^\s?#]+$/ // zod .url() needs the URL built-in, missing in CRE WASM (S1 4.2)
const DAY = 86_400

// ------------------------------------------------------------------ config

/** [minimum value, severity] pairs, ascending by value and severity, severities 1 to 5. */
const Ladder = z
  .array(z.tuple([z.number().positive(), z.number().int().min(1).max(5)]))
  .min(1)
  .refine((l) => l.every((x, i) => i === 0 || (x[0] > l[i - 1]![0] && x[1] > l[i - 1]![1])), {
    message: "ladder must rise in value and severity",
  })

export const PlaceSchema = z.object({
  place: z.string().regex(KEY),
  name: z.string().min(1).max(24), // label text: "Bergen"
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})
export const CalendarEventSchema = z.object({
  name: z.string().min(1).max(48),
  date: z.string().regex(DATE),
  market: z.string().regex(KEY),
  source: z.string().regex(HTTP_URL),
})
/**
 * A forced (demo) signal: from config, or from the agents director through the CRE bridge (S1 4.5). Expiry is either
 * `hours` from the run, or an exact `expiresAtBlock` (the director's shape). Exactly one of the two.
 */
export const ForcedSchema = z
  .object({
    kind: z.enum(SIGNAL_KINDS),
    place: z.string().regex(KEY),
    severity: z.number().int().min(1).max(5),
    label: z.string().min(1).max(MAX_LABEL),
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 14)
      .optional(),
    expiresAtBlock: z
      .string()
      .regex(/^[1-9]\d{0,19}$/)
      .optional(),
  })
  .refine((f) => (f.hours === undefined) !== (f.expiresAtBlock === undefined), {
    message: "give exactly one of hours or expiresAtBlock",
  })
  .refine(
    (f) => (f.label.endsWith(FORCED_SUFFIX) ? f.label.length : f.label.length + FORCED_SUFFIX.length) <= MAX_LABEL,
    {
      message: "label too long once (forced) is added",
    },
  )

export const ConfigSchema = z
  .object({
    weatherSchedule: z.string().min(1),
    calendarSchedule: z.string().min(1),
    weatherBaseUrl: z.string().regex(HTTP_URL),
    forecastDays: z.number().int().min(1).max(7),
    places: z.array(PlaceSchema).min(1).max(MAX_WRITES_PER_RUN),
    gustKmh: Ladder,
    rainMm: Ladder,
    calendar: z.array(CalendarEventSchema),
    calendarWindowDays: z.number().int().min(0).max(14),
    forceSignals: z.array(ForcedSchema).max(MAX_WRITES_PER_RUN),
    blocksPerSecond: z.number().int().min(1).max(100),
    chainSelectorName: z.string().min(1),
    signalOracle: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    gasLimit: z.string().regex(/^\d+$/),
  })
  .refine((c) => new Set(c.places.map((p) => p.place)).size === c.places.length, { message: "duplicate places" })
export type Config = z.infer<typeof ConfigSchema>
export type Place = z.infer<typeof PlaceSchema>
export type CalendarEvent = z.infer<typeof CalendarEventSchema>
export type Forced = z.infer<typeof ForcedSchema>
export type SignalKind = (typeof SIGNAL_KINDS)[number]

/** A kind 2 signal before its block expiry is known. `expiresAt` is unix seconds. */
export type Signal = {
  kind: SignalKind
  place: string
  severity: number
  label: string
  expiresAt: number
  /** Exact expiry block (forced signals from the director); when set it wins over expiresAt. */
  expiresBlock?: bigint
  forced: boolean
  source: string
}

// ------------------------------------------------------------------ weather (Open-Meteo)

export type DayWeather = { date: string; rainMm: number; gustKmh: number }

export function weatherUrl(c: Pick<Config, "weatherBaseUrl" | "places" | "forecastDays">): string {
  const lat = c.places.map((p) => p.lat).join(",")
  const lon = c.places.map((p) => p.lon).join(",")
  return `${c.weatherBaseUrl}?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,wind_gusts_10m_max&timezone=GMT&forecast_days=${c.forecastDays}`
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)

/**
 * Open-Meteo `/v1/forecast` with several coordinates answers a list, one entry per location in request order (one
 * location: a single object). Returns days per place; a place with any malformed day gets none (skipped, not guessed).
 */
export function parseOpenMeteo(body: string, places: Place[]): Map<string, DayWeather[]> {
  const out = new Map<string, DayWeather[]>()
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return out
  }
  const list = Array.isArray(json) ? json : [json]
  if (list.length !== places.length) return out
  places.forEach((p, i) => {
    const daily = (list[i] as { daily?: Record<string, unknown> } | null)?.daily
    const time = daily?.time
    const rain = daily?.precipitation_sum
    const gust = daily?.wind_gusts_10m_max
    if (!Array.isArray(time) || !Array.isArray(rain) || !Array.isArray(gust)) return
    if (time.length === 0 || rain.length !== time.length || gust.length !== time.length) return
    const days: DayWeather[] = []
    for (let d = 0; d < time.length; d++) {
      const date = typeof time[d] === "string" && DATE.test(time[d] as string) ? (time[d] as string) : null
      const r = num(rain[d])
      const g = num(gust[d])
      if (date === null || r === null || g === null) return
      days.push({ date, rainMm: r, gustKmh: g })
    }
    out.set(p.place, days)
  })
  return out
}

/** Highest rung reached: 0 below the first rung. */
export function severityFor(value: number, ladder: [number, number][]): number {
  let s = 0
  for (const [min, sev] of ladder) if (value >= min) s = sev
  return s
}

/** End of a UTC calendar day, unix seconds ("2026-11-08" -> 2026-11-09T00:00:00Z). */
export function endOfDay(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 1000 + DAY
}

/**
 * The worst forecast day for a place, as one signal ("Storm forecast, Bergen" for wind, "Heavy rain forecast, Lagos"
 * for rain), expiring at the end of that day. null when no day reaches the first rung.
 */
export function weatherSignal(
  p: Place,
  days: DayWeather[],
  c: Pick<Config, "gustKmh" | "rainMm">,
  source: string,
): Signal | null {
  let best: { severity: number; wind: boolean; day: DayWeather } | null = null
  for (const day of days) {
    const wind = severityFor(day.gustKmh, c.gustKmh)
    const rain = severityFor(day.rainMm, c.rainMm)
    const severity = Math.max(wind, rain)
    if (severity > 0 && (best === null || severity > best.severity)) best = { severity, wind: wind >= rain, day }
  }
  if (best === null) return null
  const label = `${best.wind ? "Storm forecast" : "Heavy rain forecast"}, ${p.name}`
  const detail = `${best.day.date}: gusts ${best.day.gustKmh} km/h, rain ${best.day.rainMm} mm`
  return {
    kind: "weather",
    place: p.place,
    severity: best.severity,
    label,
    expiresAt: endOfDay(best.day.date),
    forced: false,
    source: `${source} (${detail})`,
  }
}

// ------------------------------------------------------------------ calendar

/** "Diwali (Lakshmi Puja)" -> "Diwali", "Ramadan begins (estimated, moon sighting)" -> "Ramadan begins". */
export function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim() || name
}

/** Closer means stronger: today 5, 1 to 2 days 4, 3 to 4 days 3, 5 or more days 2. */
export function festivalSeverity(daysAway: number): number {
  if (daysAway <= 0) return 5
  if (daysAway <= 2) return 4
  if (daysAway <= 4) return 3
  return 2
}

/** Same wording as the agents director (stream-2-brain `calendarLabel`): "Diwali in 2 days", "Diwali today". */
export function festivalLabel(name: string, daysAway: number): string {
  const n = shortName(name)
  if (daysAway === 0) return `${n} today`
  return `${n} in ${daysAway} day${daysAway === 1 ? "" : "s"}`
}

/** UTC date of unix seconds. */
export function utcDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** Events from today (UTC) through `windowDays` ahead, nearest first. Past events never fire. */
export function calendarSignals(events: CalendarEvent[], nowSec: number, windowDays: number): Signal[] {
  const today = utcDate(nowSec)
  const t0 = endOfDay(today) - DAY
  return events
    .map((e) => ({ e, daysAway: Math.round((endOfDay(e.date) - DAY - t0) / DAY) }))
    .filter((x) => x.daysAway >= 0 && x.daysAway <= windowDays)
    .sort((a, b) => a.daysAway - b.daysAway || a.e.market.localeCompare(b.e.market))
    .map(({ e, daysAway }) => ({
      kind: "festival" as const,
      place: e.market,
      severity: festivalSeverity(daysAway),
      label: festivalLabel(e.name, daysAway),
      expiresAt: endOfDay(e.date),
      forced: false,
      source: `${e.name} ${e.date} ${e.source}`,
    }))
}

// ------------------------------------------------------------------ forced

/** Golden rule: a forced signal always says so. The suffix is added if the config left it out. */
export function forcedSignal(f: Forced, nowSec: number): Signal {
  const label = f.label.endsWith(FORCED_SUFFIX) ? f.label : `${f.label}${FORCED_SUFFIX}`
  const base = {
    kind: f.kind,
    place: f.place,
    severity: f.severity,
    label,
    forced: true,
    source: "forceSignals (demo)",
  }
  if (f.expiresAtBlock !== undefined) return { ...base, expiresAt: 0, expiresBlock: BigInt(f.expiresAtBlock) }
  return { ...base, expiresAt: nowSec + (f.hours ?? 0) * 3600 }
}

// ------------------------------------------------------------------ chain

/**
 * Block by which the signal expires, from the chain's own head: head + (seconds left x blocks per second), rounded
 * up. Base runs ~5 blocks/s (D-50). null when already expired by chain time (never written: SignalOracle would revert).
 */
export function expiresAtBlock(
  s: Pick<Signal, "expiresAt" | "expiresBlock">,
  head: bigint,
  headTime: number,
  blocksPerSecond: number,
) {
  if (s.expiresBlock !== undefined) return s.expiresBlock > head ? s.expiresBlock : null
  const left = s.expiresAt - headTime
  if (left <= 0) return null
  return head + BigInt(Math.ceil(left * blocksPerSecond))
}

export function toBytes32(s: string): Hex {
  if (s.length === 0 || s.length > 32 || !/^[\x20-\x7e]+$/.test(s)) throw new Error(`not a bytes32 key: ${s}`)
  return stringToHex(s, { size: 32 })
}

/** kind 2: abi.encode(bytes32 signalKind, bytes32 place, uint8 severity, uint64 expiresAtBlock, string label) */
export function encodeSignalReport(s: Signal, expiresBlock: bigint): Hex {
  if (s.severity < 1 || s.severity > 5) throw new Error(`severity ${s.severity} out of range`)
  if (s.label.length === 0 || s.label.length > MAX_LABEL) throw new Error(`label length ${s.label.length}`)
  if (s.forced && !s.label.endsWith(FORCED_SUFFIX)) throw new Error("forced signal without the (forced) label")
  const body = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint64" }, { type: "string" }],
    [toBytes32(s.kind), toBytes32(s.place), s.severity, expiresBlock, s.label],
  )
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [KIND_SIGNAL, body])
}

/** Keeps at most `max` signals: real ones first (nearest calendar first, then weather), forced last. */
export function capSignals(signals: Signal[], max = MAX_WRITES_PER_RUN): { keep: Signal[]; dropped: Signal[] } {
  const ordered = [...signals.filter((s) => !s.forced), ...signals.filter((s) => s.forced)]
  return { keep: ordered.slice(0, max), dropped: ordered.slice(max) }
}
