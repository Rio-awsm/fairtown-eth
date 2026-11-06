import { describe, expect, test } from "bun:test"
import { decodeAbiParameters, hexToString, type Hex } from "viem"
import configJson from "../config.json"
import {
  ConfigSchema,
  FORCED_SUFFIX,
  calendarSignals,
  capSignals,
  encodeSignalReport,
  endOfDay,
  expiresAtBlock,
  festivalLabel,
  festivalSeverity,
  forcedSignal,
  parseOpenMeteo,
  severityFor,
  shortName,
  weatherSignal,
  weatherUrl,
  type Signal,
} from "../src/lib"

const config = ConfigSchema.parse(configJson)
const GUST = config.gustKmh as [number, number][]
const RAIN = config.rainMm as [number, number][]
const NOW_2026_11_06 = Date.UTC(2026, 10, 6, 7, 55) / 1000 // 07:55 UTC, the day these tests were written
const b32 = (h: Hex) => hexToString(h, { size: 32 })

// Open-Meteo answer for the five places on 2026-11-06 (forecast_days=2): every place calm.
const day = (d: string, rain: number, gust: number) => ({ d, rain, gust })
const live = (rows: { d: string; rain: number; gust: number }[][]) =>
  JSON.stringify(
    rows.map((days, i) => ({
      latitude: config.places[i]!.lat,
      longitude: config.places[i]!.lon,
      daily_units: { time: "iso8601", precipitation_sum: "mm", wind_gusts_10m_max: "km/h" },
      daily: {
        time: days.map((x) => x.d),
        precipitation_sum: days.map((x) => x.rain),
        wind_gusts_10m_max: days.map((x) => x.gust),
      },
    })),
  )
const CALM = live([
  [day("2026-11-06", 0, 25.2), day("2026-11-07", 0, 15.1)],
  [day("2026-11-06", 2.1, 32.4), day("2026-11-07", 0, 33.1)],
  [day("2026-11-06", 0, 29.9), day("2026-11-07", 0, 32.8)],
  [day("2026-11-06", 4.2, 34.6), day("2026-11-07", 8.5, 40.3)],
  [day("2026-11-06", 0.8, 36), day("2026-11-07", 3.5, 33.1)],
])

describe("config", () => {
  test("the committed config is valid: five places, D-13 ladders, S2's festival calendar, one forced signal", () => {
    expect(config.places.map((p) => p.place)).toEqual(["bergen", "dallas", "mumbai", "nairobi", "lagos"])
    expect(config.calendar.length).toBe(11)
    expect(config.forceSignals).toHaveLength(1)
  })
  test("rejects ladders that don't rise, duplicate places, too many writes and bad coordinates", () => {
    const ok = (patch: Record<string, unknown>) => ConfigSchema.safeParse({ ...configJson, ...patch }).success
    expect(
      ok({
        gustKmh: [
          [50, 3],
          [65, 2],
        ],
      }),
    ).toBe(false)
    expect(
      ok({
        gustKmh: [
          [65, 2],
          [50, 3],
        ],
      }),
    ).toBe(false)
    expect(ok({ rainMm: [[20, 6]] })).toBe(false)
    expect(ok({ places: [config.places[0], config.places[0]] })).toBe(false)
    expect(ok({ places: Array.from({ length: 11 }, (_, i) => ({ place: `p${i}`, name: "P", lat: 0, lon: 0 })) })).toBe(
      false,
    )
    expect(ok({ places: [{ place: "x", name: "X", lat: 91, lon: 0 }] })).toBe(false)
    expect(ok({ forceSignals: [{ kind: "rumour", place: "x", severity: 2, label: "x", hours: 1 }] })).toBe(false)
    expect(ok({ weatherBaseUrl: "api.open-meteo.com/v1/forecast" })).toBe(false)
    expect(ok({})).toBe(true)
  })
})

describe("severity ladders (D-13 real-world levels)", () => {
  test("gusts: 50 -> 2, 65 -> 3, 80 -> 4, 100 -> 5; rain: 20 -> 2, 40 -> 3, 70 -> 4", () => {
    const g = (v: number) => severityFor(v, GUST)
    const r = (v: number) => severityFor(v, RAIN)
    expect([g(0), g(49.9), g(50), g(64.9), g(65), g(80), g(99.9), g(100), g(180)]).toEqual([0, 0, 2, 2, 3, 4, 4, 5, 5])
    expect([r(0), r(19.9), r(20), r(40), r(69.9), r(70), r(300)]).toEqual([0, 0, 2, 3, 3, 4, 4])
  })
})

describe("weather", () => {
  test("one request for all places, GMT days", () => {
    expect(weatherUrl(config)).toBe(
      "https://api.open-meteo.com/v1/forecast?latitude=60.39,32.78,19.08,-1.29,6.52&longitude=5.32,-96.8,72.88,36.82,3.38&daily=precipitation_sum,wind_gusts_10m_max&timezone=GMT&forecast_days=2",
    )
  })
  test("today's real forecast: every place calm, no weather signal", () => {
    const f = parseOpenMeteo(CALM, config.places)
    expect(f.size).toBe(5)
    for (const p of config.places) expect(weatherSignal(p, f.get(p.place)!, config, "x")).toBeNull()
  })
  test("a storm takes the worst day, wind wins ties, rain alone says rain", () => {
    const bergen = config.places[0]!
    const s = weatherSignal(
      bergen,
      [
        { date: "2026-11-06", rainMm: 25, gustKmh: 30 },
        { date: "2026-11-07", rainMm: 5, gustKmh: 82 },
      ],
      config,
      "Open-Meteo",
    )!
    expect(s).toMatchObject({
      kind: "weather",
      place: "bergen",
      severity: 4,
      label: "Storm forecast, Bergen",
      forced: false,
    })
    expect(s.expiresAt).toBe(endOfDay("2026-11-07"))
    expect(s.source).toContain("gusts 82 km/h")
    const tie = weatherSignal(bergen, [{ date: "2026-11-06", rainMm: 20, gustKmh: 50 }], config, "")!
    expect(tie.label).toBe("Storm forecast, Bergen")
    const lagos = config.places[4]!
    expect(weatherSignal(lagos, [{ date: "2026-11-06", rainMm: 45, gustKmh: 20 }], config, "")!.label).toBe(
      "Heavy rain forecast, Lagos",
    )
  })
  test("malformed answers skip the place, never guess", () => {
    const one = (d: unknown) =>
      parseOpenMeteo(
        JSON.stringify([d, ...Array(4).fill({ daily: { time: [], precipitation_sum: [], wind_gusts_10m_max: [] } })]),
        config.places,
      )
    expect(
      one({ daily: { time: ["2026-11-06"], precipitation_sum: [null], wind_gusts_10m_max: [80] } }).has("bergen"),
    ).toBe(false)
    expect(
      one({ daily: { time: ["2026-11-06"], precipitation_sum: [1], wind_gusts_10m_max: [-3] } }).has("bergen"),
    ).toBe(false)
    expect(one({ daily: { time: ["06/11"], precipitation_sum: [1], wind_gusts_10m_max: [3] } }).has("bergen")).toBe(
      false,
    )
    expect(
      one({ daily: { time: ["2026-11-06"], precipitation_sum: [1, 2], wind_gusts_10m_max: [3] } }).has("bergen"),
    ).toBe(false)
    expect(parseOpenMeteo("[]", config.places).size).toBe(0) // wrong count
    expect(parseOpenMeteo("not json", config.places).size).toBe(0)
    expect(parseOpenMeteo('{"error":true,"reason":"Rate limit"}', config.places).size).toBe(0)
  })
})

describe("calendar", () => {
  test("Diwali (8 Nov) is in 2 days for Mumbai and Pune; nothing past or beyond 7 days", () => {
    const s = calendarSignals(config.calendar, NOW_2026_11_06, 7)
    expect(s.map((x) => [x.place, x.severity, x.label])).toEqual([
      ["mumbai", 4, "Diwali in 2 days"],
      ["pune", 4, "Diwali in 2 days"],
    ])
    expect(s[0]!.expiresAt).toBe(endOfDay("2026-11-08"))
    expect(s[0]!.source).toContain("timeanddate.com")
    expect(calendarSignals(config.calendar, Date.UTC(2026, 10, 9) / 1000, 7)).toEqual([]) // after Diwali
    expect(calendarSignals(config.calendar, Date.UTC(2026, 10, 19) / 1000, 7).map((x) => x.label)).toEqual([
      "Thanksgiving in 7 days",
      "Thanksgiving in 7 days",
    ])
  })
  test("labels and severity by distance", () => {
    expect(festivalLabel("Diwali (Lakshmi Puja)", 0)).toBe("Diwali today")
    expect(festivalLabel("Diwali (Lakshmi Puja)", 1)).toBe("Diwali in 1 day")
    expect(shortName("Ramadan begins (estimated, moon sighting)")).toBe("Ramadan begins")
    expect([0, 1, 2, 3, 4, 5, 7].map(festivalSeverity)).toEqual([5, 4, 4, 3, 3, 2, 2])
  })
  test("the event day itself is 'today', late in the day too", () => {
    const late = Date.UTC(2026, 10, 8, 23, 59) / 1000
    expect(calendarSignals(config.calendar, late, 0).map((x) => x.label)).toEqual(["Diwali today", "Diwali today"])
  })
})

describe("forced signals (key rule: always labelled)", () => {
  test("the suffix is added once, and the signal is marked forced", () => {
    const f = forcedSignal(config.forceSignals[0]!, NOW_2026_11_06)
    expect(f).toMatchObject({
      kind: "festival",
      place: "nairobi",
      severity: 4,
      label: "Valentine's cargo cutoff (forced)",
      forced: true,
    })
    expect(f.expiresAt).toBe(NOW_2026_11_06 + 6 * 3600)
    expect(forcedSignal({ ...config.forceSignals[0]!, label: "Storm forecast, Bergen (forced)" }, 0).label).toBe(
      "Storm forecast, Bergen (forced)",
    )
  })
  test("encoding refuses a forced signal that lost its label", () => {
    const f = { ...forcedSignal(config.forceSignals[0]!, NOW_2026_11_06), label: "Valentine's cargo cutoff" }
    expect(() => encodeSignalReport(f, 1n)).toThrow(/forced/)
    expect(FORCED_SUFFIX).toBe(" (forced)")
  })
})

describe("expiry and encoding", () => {
  const sig: Signal = {
    kind: "festival",
    place: "mumbai",
    severity: 4,
    label: "Diwali in 2 days",
    expiresAt: 1_000,
    forced: false,
    source: "x",
  }
  test("expiresAtBlock from the chain head at ~5 blocks/s, rounded up; past expiry is null", () => {
    expect(expiresAtBlock(sig, 55_000_000n, 900, 5)).toBe(55_000_500n)
    expect(expiresAtBlock({ expiresAt: 1_000.5 }, 0n, 1_000, 5)).toBe(3n)
    expect(expiresAtBlock(sig, 55_000_000n, 1_000, 5)).toBeNull()
    expect(expiresAtBlock(sig, 55_000_000n, 2_000, 5)).toBeNull()
  })
  test("kind 2 decodes to (signalKind, place, severity, expiresAtBlock, label)", () => {
    const [kind, body] = decodeAbiParameters(
      [{ type: "uint8" }, { type: "bytes" }],
      encodeSignalReport(sig, 55_000_500n),
    )
    expect(kind).toBe(2)
    const v = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint64" }, { type: "string" }],
      body,
    )
    expect([b32(v[0]), b32(v[1]), v[2], v[3], v[4]]).toEqual(["festival", "mumbai", 4, 55_000_500n, "Diwali in 2 days"])
  })
  test("refuses severity outside 1 to 5 and empty or long labels", () => {
    expect(() => encodeSignalReport({ ...sig, severity: 0 }, 1n)).toThrow()
    expect(() => encodeSignalReport({ ...sig, severity: 6 }, 1n)).toThrow()
    expect(() => encodeSignalReport({ ...sig, label: "" }, 1n)).toThrow()
    expect(() => encodeSignalReport({ ...sig, label: "x".repeat(65) }, 1n)).toThrow()
  })
  test("capSignals keeps real signals first and forced ones last, at most 10", () => {
    const real = Array.from({ length: 9 }, (_, i) => ({ ...sig, place: `p${i}` }))
    const forced = [
      { ...sig, place: "f1", forced: true },
      { ...sig, place: "f2", forced: true },
    ]
    const { keep, dropped } = capSignals([...forced, ...real])
    expect(keep).toHaveLength(10)
    expect(keep.slice(0, 9).every((s) => !s.forced)).toBe(true)
    expect(dropped.map((s) => s.place)).toEqual(["f2"])
  })
})
