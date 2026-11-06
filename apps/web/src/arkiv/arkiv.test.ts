import { getAddress } from "viem"
import type { TownEnvelope, TownEvent } from "@fairtown/shared/protocol"
import { and, between, eq, exists, gte, or, startsWith } from "@arkiv-network/sdk/query"
import { str, u256, u64 } from "@arkiv-network/sdk/schema"
import { describe, expect, it } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { SAMPLE_EVENTS as S, SELLER, envelope } from "../test/samples"
import { evaluate, runLocal } from "./evaluate"
import { appendLedger, emptyLedger, type PriceRow } from "./mockLedger"
import { allClears, clearsFor, latestReputations, queryText, sellerRecord } from "./queries"
import { marketWeather, sparkPoints, weatherBand } from "./weather"

const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const DAY = 86_400_000
const at = (event: TownEvent, ts: number): TownEnvelope => ({ ...envelope(event), ts })

describe("query text is the SDK's own", () => {
  it("prints the price query for a commodity", () => {
    expect(queryText(clearsFor({ commodity: "cod" }))).toBe(
      "arkiv.schema = str('fairtown.v1.price') AND commodity = str('cod') ORDER BY day:str DESC",
    )
  })

  it("prints a filtered price query with commodity and place", () => {
    expect(queryText(clearsFor({ commodity: "cod", place: "bergen" }))).toBe(
      "arkiv.schema = str('fairtown.v1.price') AND commodity = str('cod') AND place = str('bergen') ORDER BY day:str DESC",
    )
  })

  it("prints a seller's reputation query", () => {
    expect(queryText(sellerRecord(SELLER))).toBe(
      `arkiv.schema = str('fairtown.v1.reputation') AND seller = addr(${getAddress(SELLER)}) ORDER BY day:str DESC`,
    )
  })
})

describe("evaluate", () => {
  const row = { commodity: "cod", place: "bergen", avgPerUnit: 9_100_000n, day: 20_398n }
  it.each([
    [eq("commodity", str("cod")), true],
    [eq("commodity", str("rose")), false],
    [gte("avgPerUnit", u256(9_100_000n)), true],
    [gte("avgPerUnit", u256(9_100_001n)), false],
    [and(eq("commodity", str("cod")), gte("day", u64(20_398))), true],
    [or(eq("commodity", str("rose")), eq("place", str("bergen"))), true],
    [between("day", u64(20_390), u64(20_400)), true],
    [startsWith("place", str("ber")), true],
    [exists("grade"), false],
  ] as const)("%o is %s", (expr, expected) => {
    expect(evaluate(expr, row)).toBe(expected)
  })
})

describe("mock ledger from the relay (contract 10 rules)", () => {
  const listed = run([S["lot.listed"]])

  it("writes one price record when a lot settles, with the listing's market data", () => {
    const ledger = appendLedger(emptyLedger(), listed, at(S["lot.settled"], 3 * DAY + 5))
    expect(ledger.price).toEqual([
      {
        $key: expect.stringMatching(/^0x/),
        sector: "fish",
        commodity: "cod",
        grade: "fresh_a",
        market: "fish_dock",
        place: "bergen",
        currency: "EUR",
        lotId: 12n,
        finalClearingPerUnit: 9_000_000n,
        avgPerUnit: 9_100_000n,
        soldUnits: 600n,
        day: 3n,
        tx: S["lot.settled"].tx,
      },
    ])
  })

  it("writes a new reputation record on every seller record", () => {
    let ledger = appendLedger(emptyLedger(), listed, at(S["seller.record"], DAY))
    ledger = appendLedger(ledger, listed, at({ ...S["seller.record"], noShows: 1, proven: false }, 2 * DAY))
    expect(ledger.reputation.map((r) => [r.noShows, r.tier, r.day])).toEqual([
      [0n, "proven", 1n],
      [1n, "new", 2n],
    ])
  })

  it("ignores a settlement for a lot it never saw listed", () => {
    expect(appendLedger(emptyLedger(), initialTownState, at(S["lot.settled"], DAY)).price).toEqual([])
  })
})

describe("runLocal", () => {
  const rows = (n: number): PriceRow[] =>
    Array.from({ length: n }, (_, i) => ({
      $key: `0x${i}`,
      sector: "fish",
      commodity: i % 2 ? "cod" : "haddock",
      grade: "fresh_a",
      market: "fish_dock",
      place: "bergen",
      currency: "EUR",
      lotId: BigInt(i),
      finalClearingPerUnit: 1n,
      avgPerUnit: BigInt(100 + i),
      soldUnits: 1n,
      day: BigInt(i),
      tx: "0x",
    }))

  it("filters, sorts newest first and limits like the node", () => {
    const out = runLocal(clearsFor({ commodity: "cod", limit: 3 }), { price: rows(10), reputation: [] })
    expect(out.map((r) => r.day)).toEqual([9n, 7n, 5n])
  })

  it("keeps only the latest reputation per seller", () => {
    const out = latestReputations([
      { $key: "a", seller: "s1", tier: "new", cleanLots: 1n, noShows: 0n, day: 1n },
      { $key: "b", seller: "s1", tier: "proven", cleanLots: 3n, noShows: 0n, day: 4n },
      { $key: "c", seller: "s2", tier: "new", cleanLots: 0n, noShows: 1n, day: 2n },
    ])
    expect(out.map((r) => [r.seller, r.tier])).toEqual([
      ["s1", "proven"],
      ["s2", "new"],
    ])
  })

  it("lists all clears newest first", () => {
    expect(runLocal(allClears(5), { price: rows(10), reputation: [] }).map((r) => r.day)).toEqual([9n, 8n, 7n, 6n, 5n])
  })
})

describe("price weather", () => {
  it.each([
    [10_000n, 10_000n, "normal"],
    [10_499n, 10_000n, "normal"],
    [10_500n, 10_000n, "higher"],
    [11_499n, 10_000n, "higher"],
    [11_500n, 10_000n, "much_higher"],
    [9_501n, 10_000n, "normal"],
    [9_500n, 10_000n, "lower"],
    [8_500n, 10_000n, "much_lower"],
  ] as const)("latest %s against average %s is %s", (latest, avg, band) => {
    expect(weatherBand(latest, avg)).toBe(band)
  })

  const price = (market: string, currency: string, avg: bigint, day: bigint): PriceRow => ({
    $key: `0x${market}${day}`,
    sector: "fish",
    commodity: "cod",
    grade: "fresh_a",
    market,
    place: "bergen",
    currency,
    lotId: day,
    finalClearingPerUnit: avg,
    avgPerUnit: avg,
    soldUnits: 1n,
    day,
    tx: "0x",
  })

  it("compares each market to its own 30-day average, per currency", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => price("fish_dock", "EUR", 10_000n, BigInt(100 + i))),
      price("fish_dock", "EUR", 13_000n, 110n),
      price("fish_dock", "USD", 1n, 110n),
      price("fish_dock", "EUR", 1n, 60n),
    ]
    const w = marketWeather(rows, 110n)
    expect(w).toContainEqual(
      expect.objectContaining({ market: "fish_dock", currency: "EUR", band: "much_higher", latest: 13_000n }),
    )
    expect(w.find((x) => x.market === "fish_dock" && x.currency === "EUR")?.average).toBe(10_272n)
    expect(w).toContainEqual(expect.objectContaining({ market: "fish_dock", currency: "USD", band: "normal" }))
  })

  it("never compares one commodity with another's average", () => {
    const cod = price("fish_dock", "EUR", 10_000n, 5n)
    const haddock = { ...price("fish_dock", "EUR", 5_000n, 5n), commodity: "haddock", lotId: 99n }
    const w = marketWeather([cod, haddock], 5n)
    expect(w.map((x) => [x.commodity, x.band])).toEqual([
      ["cod", "normal"],
      ["haddock", "normal"],
    ])
  })

  it("takes the newest record of a day by lot id, whatever order rows arrive in", () => {
    const rows = [price("fish_dock", "EUR", 900n, 5n), price("fish_dock", "EUR", 100n, 5n)]
    rows[0]!.lotId = 61n
    rows[1]!.lotId = 60n
    expect(marketWeather(rows, 5n)[0]?.latest).toBe(900n)
  })

  it("draws a sparkline from daily averages", () => {
    expect(sparkPoints([1n, 3n, 2n], 100, 20)).toBe("0,20 50,0 100,10")
    expect(sparkPoints([5n], 100, 20)).toBe("0,10 100,10")
    expect(sparkPoints([], 100, 20)).toBe("")
  })
})
