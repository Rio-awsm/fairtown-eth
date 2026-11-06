import { describe, expect, test } from "bun:test"
import { decodeAbiParameters, hexToString, type Hex } from "viem"
import configJson from "../config.json"
import {
  ConfigSchema,
  MAX_WRITES_PER_RUN,
  encodeFxReport,
  encodeReferenceReport,
  formatE8,
  fxUrl,
  numberText,
  parseFrankfurterV2,
  parseReference,
  referenceUrl,
  scaleDecimal,
  sourceTag,
  toBytes32,
  type Reference,
} from "../src/lib"

const QUOTES = ["EUR", "NOK", "INR", "KES", "NGN"]
// Exact body Frankfurter v2 returned on 2026-11-06 for these quotes.
const LIVE_BODY =
  '[{"date":"2026-11-06","base":"USD","quote":"EUR","rate":0.88903},{"date":"2026-11-06","base":"USD","quote":"INR","rate":94.46},{"date":"2026-11-06","base":"USD","quote":"KES","rate":129.81},{"date":"2026-11-06","base":"USD","quote":"NGN","rate":1346.12},{"date":"2026-11-06","base":"USD","quote":"NOK","rate":9.2745}]'

const unbytes32 = (h: Hex) => hexToString(h, { size: 32 })

describe("config", () => {
  test("the committed config is valid and stays within the write limit", () => {
    const c = ConfigSchema.parse(configJson)
    expect(c.fxQuotes).toEqual(QUOTES)
    expect(c.pairs).toHaveLength(5) // D-16
    expect(c.fxQuotes.length).toBeLessThanOrEqual(MAX_WRITES_PER_RUN)
    expect(c.pairs.length).toBeLessThanOrEqual(MAX_WRITES_PER_RUN)
  })
  test("rejects too many writes, duplicates, bad keys and bad addresses", () => {
    const bad = (patch: Record<string, unknown>) => ConfigSchema.safeParse({ ...configJson, ...patch }).success
    expect(bad({ fxQuotes: Array.from({ length: 11 }, (_, i) => `X${String.fromCharCode(65 + i)}A`) })).toBe(false)
    expect(bad({ fxQuotes: ["EUR", "EUR"] })).toBe(false)
    expect(bad({ fxQuotes: ["eur"] })).toBe(false)
    expect(
      bad({
        pairs: [
          { commodity: "cod", market: "bergen" },
          { commodity: "cod", market: "bergen" },
        ],
      }),
    ).toBe(false)
    expect(bad({ pairs: [{ commodity: "Cod", market: "bergen" }] })).toBe(false)
    expect(bad({ pairs: [] })).toBe(false)
    expect(bad({ signalOracle: "0x123" })).toBe(false)
    expect(bad({ gasLimit: "4e5" })).toBe(false)
    expect(bad({ fxBaseUrl: "ftp://x" })).toBe(false)
    expect(bad({ referenceUrl: "localhost:8787/api/reference" })).toBe(false)
    expect(bad({ referenceUrl: "http://localhost:8787/api/reference?commodity=cod" })).toBe(false) // query is added per pair
    expect(bad({})).toBe(true)
  })
})

describe("decimals", () => {
  test("scaleDecimal is exact, rounds half up past the scale, refuses non-decimals", () => {
    expect(scaleDecimal("0.88903", 8)).toBe(88_903_000n)
    expect(scaleDecimal("1346.12", 8)).toBe(134_612_000_000n)
    expect(scaleDecimal("9", 8)).toBe(900_000_000n)
    expect(scaleDecimal("0.123456784", 8)).toBe(12_345_678n)
    expect(scaleDecimal("0.123456785", 8)).toBe(12_345_679n)
    expect(scaleDecimal("0", 8)).toBe(0n)
    for (const bad of ["", "-1", "1e5", " 1", "1.", ".5", "1,5", "NaN", "0x10"]) expect(scaleDecimal(bad, 8)).toBeNull()
  })
  test("numberText gives back the JSON text for short rates, refuses exponents and non-positives", () => {
    expect(numberText(0.88903)).toBe("0.88903")
    expect(numberText(1346.12)).toBe("1346.12")
    expect(numberText(9.2745)).toBe("9.2745")
    expect(numberText(1e-7)).toBeNull()
    expect(numberText(1e21)).toBeNull()
    expect(numberText(0)).toBeNull()
    expect(numberText(-1)).toBeNull()
    expect(numberText("0.9")).toBeNull()
    expect(numberText(Number.NaN)).toBeNull()
  })
  test("formatE8 is for logs only", () => {
    expect(formatE8(88_903_000n)).toBe("0.88903000")
    expect(formatE8(134_612_000_000n)).toBe("1346.12000000")
  })
})

describe("parseFrankfurterV2", () => {
  test("parses the live response for all five quotes, exactly", () => {
    const { rates, skipped } = parseFrankfurterV2(LIVE_BODY, QUOTES)
    expect(skipped).toEqual([])
    expect(rates).toEqual([
      { quote: "EUR", perUsdE8: 88_903_000n, date: "2026-11-06" },
      { quote: "NOK", perUsdE8: 927_450_000n, date: "2026-11-06" },
      { quote: "INR", perUsdE8: 9_446_000_000n, date: "2026-11-06" },
      { quote: "KES", perUsdE8: 12_981_000_000n, date: "2026-11-06" },
      { quote: "NGN", perUsdE8: 134_612_000_000n, date: "2026-11-06" },
    ])
    expect(fxUrl("https://api.frankfurter.dev/v2/rates", QUOTES)).toBe(
      "https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,NOK,INR,KES,NGN",
    )
  })
  test("skips missing pairs and bad rows, never yields a zero", () => {
    const body = JSON.stringify([
      { date: "2026-11-06", base: "USD", quote: "EUR", rate: 0.889 },
      { date: "2026-11-06", base: "USD", quote: "NOK", rate: 0 },
      { date: "06/11/2026", base: "USD", quote: "INR", rate: 94.46 },
      { date: "2026-11-06", base: "EUR", quote: "KES", rate: 145.2 },
      { date: "2026-11-06", base: "USD", quote: "CHF", rate: 0.8 },
      { date: "2026-11-06", base: "USD", quote: "EUR", rate: 5 }, // duplicate: first one wins
      "junk",
      null,
    ])
    const { rates, skipped } = parseFrankfurterV2(body, QUOTES)
    expect(rates).toEqual([{ quote: "EUR", perUsdE8: 88_900_000n, date: "2026-11-06" }])
    expect(skipped.map((s) => s.key).sort()).toEqual(["INR", "KES", "NGN", "NOK"])
    expect(skipped.find((s) => s.key === "NGN")!.reason).toBe("missing from response")
    expect(skipped.find((s) => s.key === "KES")!.reason).toContain("not USD")
  })
  test("garbage bodies skip everything", () => {
    for (const body of ["", "<html>rate limited</html>", "{}", '{"rates":{"EUR":0.9}}']) {
      const { rates, skipped } = parseFrankfurterV2(body, QUOTES)
      expect(rates).toEqual([])
      expect(skipped).toHaveLength(5)
    }
  })
})

describe("parseReference", () => {
  const cod = { commodity: "cod", market: "bergen" }
  // Shape served by services/agents (stream-2-brain, src/data/references.json).
  const body = JSON.stringify({
    commodity: "cod",
    market: "bergen",
    perUnit: "8300000",
    currency: "EUR",
    date: "2026-11-05",
    source: "illustrative: scene value; replace with the Rafisklaget minimum price before the demo",
    sourceUrl: "https://www.rafisklaget.no/minstepriser",
  })
  test("parses the agents service answer", () => {
    const r = parseReference(body, cod)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ref.perUnit).toBe(8_300_000n)
      expect(r.ref.currency).toBe("EUR")
      expect(r.ref.date).toBe("2026-11-05")
    }
    expect(referenceUrl("http://localhost:8787/api/reference", { commodity: "gpu_hour", market: "any_dc" })).toBe(
      "http://localhost:8787/api/reference?commodity=gpu_hour&market=any_dc",
    )
  })
  test("refuses zero, unparsed numbers, unknown currencies, wrong pairs and junk", () => {
    const with_ = (patch: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(body), ...patch })
    const reasons = [
      parseReference(with_({ perUnit: "0" }), cod),
      parseReference(with_({ perUnit: 8.3 }), cod),
      parseReference(with_({ perUnit: "8.30" }), cod),
      parseReference(with_({ perUnit: "-1" }), cod),
      parseReference(with_({ currency: "NOK" }), cod),
      parseReference(with_({ date: "yesterday" }), cod),
      parseReference(with_({ source: "" }), cod),
      parseReference(with_({ market: "oslo" }), cod),
      parseReference('{"error":"not found"}', cod),
      parseReference("not json", cod),
    ]
    for (const r of reasons) expect(r.ok).toBe(false)
  })
})

describe("encoding (contract 7.7, ICR-005)", () => {
  const asOf = 1_793_946_195n
  test("kind 3 decodes to (EUR, perUsdE8, asOf)", () => {
    const [kind, body] = decodeAbiParameters(
      [{ type: "uint8" }, { type: "bytes" }],
      encodeFxReport({ quote: "EUR", perUsdE8: 88_903_000n }, asOf),
    )
    expect(kind).toBe(3)
    const [code, rate, at] = decodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], body)
    expect(unbytes32(code)).toBe("EUR")
    expect(rate).toBe(88_903_000n)
    expect(at).toBe(asOf)
  })
  test("kind 1 decodes to (commodity, market, perUnit, currency, sourceTag, asOf)", () => {
    const ref: Reference = {
      commodity: "truck_capacity",
      market: "dallas",
      perUnit: 120_000n,
      currency: "USD",
      date: "2026-11-05",
      source: "illustrative",
      sourceUrl: "",
    }
    const [kind, body] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], encodeReferenceReport(ref, asOf))
    expect(kind).toBe(1)
    const v = decodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint64" },
      ],
      body,
    )
    expect([unbytes32(v[0]), unbytes32(v[1]), v[2], unbytes32(v[3]), unbytes32(v[4]), v[5]]).toEqual([
      "truck_capacity",
      "dallas",
      120_000n,
      "USD",
      "api:2026-11-05",
      asOf,
    ])
  })
  test("keys match @fairtown/shared toKey and zero values are never encoded", () => {
    expect(toBytes32("fish")).toBe(`0x66697368${"0".repeat(56)}`)
    expect(sourceTag("2026-11-05")).toBe(toBytes32("api:2026-11-05"))
    expect(() => toBytes32("")).toThrow()
    expect(() => toBytes32("x".repeat(33))).toThrow()
    expect(() => toBytes32("naïve")).toThrow()
    expect(() => encodeFxReport({ quote: "EUR", perUsdE8: 0n }, asOf)).toThrow(/zero/)
    expect(() =>
      encodeReferenceReport(
        {
          commodity: "cod",
          market: "bergen",
          perUnit: 0n,
          currency: "EUR",
          date: "2026-11-05",
          source: "x",
          sourceUrl: "",
        },
        asOf,
      ),
    ).toThrow(/zero/)
  })
})
