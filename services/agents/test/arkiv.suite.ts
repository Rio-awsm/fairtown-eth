import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import type { Address } from "viem"
import { expect, it } from "vitest"
import type { ArkivStore, ArkivValue } from "../src/arkiv/ArkivStore"

const S = ARKIV_SCHEMAS
const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))

// One sample per schema, in contract section 10 shape.
export const samples = (run: string, me: Address, id = 9_000_000n): Record<keyof typeof S, Record<string, ArkivValue>> => ({
  lot: {
    sector: "fish", commodity: "cod", grade: "fresh_a", market: "fish_dock", place: "bergen", currency: "EUR", status: "open",
    lotId: id + 1n, auction: "0x00000000000000000000000000000000000000a1", floorPerUnit: 7_500_000n, endBlock: 46n, parentLotId: 0n,
    details: json({ run, photos: ["0xabc"], grade: { grade: "fresh_a" } }),
  },
  bid: { lotId: id + 1n, agent: me, maxPerUnit: 9_100_000n, amount: 5_460_000_000n, block: 12n, reason: `test ${run}` },
  price: {
    sector: "fish", commodity: "cod", grade: "fresh_a", market: "fish_dock", place: "bergen", currency: "EUR", lotId: id + 1n,
    finalClearingPerUnit: 9_100_000n, avgPerUnit: 9_100_000n, soldUnits: 600n, day: `test-${run}`, tx: "0xfeed",
  },
  reputation: { seller: me, tier: "new", cleanLots: 1n, noShows: 0n, day: `test-${run}`, lastLotId: id + 1n, tx: "0xfeed" },
  capacity: { kind: "truck", fromMarket: "fish_dock", toPlace: "oslo", qty: 600n, readyByBlock: 346n, lotId: id + 2n, notes: `test ${run}` },
  signal: { kind: "weather", place: "bergen", severity: 3n, expiresAtBlock: 900n, label: `Storm (test ${run})` },
  agent: { role: "BUYER", name: `test-agent-${run}`, building: "fish_dock", mandate: json({ commodities: ["cod"] }) },
})

// The same behaviour, checked against memory and live.
export function arkivSuite(make: () => ArkivStore | Promise<ArkivStore>, me: Address, run: string, id = 9_000_000n) {
  it("writes each of the seven schemas and reads it back by key and by indexed filter", async () => {
    const store = await make()
    const all = samples(run, me, id)
    for (const [name, values] of Object.entries(all) as Array<[keyof typeof S, Record<string, ArkivValue>]>) {
      const dedupeField = name === "agent" ? "name" : name === "signal" ? "label" : "lotId"
      const dedupe = (S[name].indexed as readonly string[]).includes(dedupeField) ? { [dedupeField]: values[dedupeField] as string | bigint } : undefined
      const { key } = await store.put(S[name], values, { owner: me, expiresInSeconds: 3600, ...(dedupe ? { dedupe } : {}) })
      const back = await store.get(S[name], key)
      expect(back, name).toBeDefined()
      for (const [k, v] of Object.entries(values)) expect(back!.values[k], `${name}.${k}`).toEqual(v)
    }
    const prices = await store.query(S.price, { day: `test-${run}`, commodity: "cod" })
    expect(prices.entities).toHaveLength(1)
    expect(prices.entities[0]!.values.avgPerUnit).toBe(9_100_000n)
    const bids = await store.query(S.bid, { lotId: id + 1n, maxPerUnit: { gte: 9_000_000n } }, { owner: me })
    expect(bids.entities.some((b) => b.values.reason === `test ${run}`)).toBe(true)
  })

  it("patches a lot's status, keeps other columns, and dedupes a repeated create", async () => {
    const store = await make()
    const lot = { ...samples(run, me, id).lot, lotId: id + 100n, status: "open" }
    const first = await store.put(S.lot, lot, { owner: me, expiresInSeconds: 3600, dedupe: { lotId: id + 100n } })
    const again = await store.put(S.lot, lot, { owner: me, expiresInSeconds: 3600, dedupe: { lotId: id + 100n } })
    expect(again).toEqual({ key: first.key, reused: true })
    await store.put(S.lot, { status: "sold" }, { owner: me, expiresInSeconds: 3600, key: first.key })
    const back = await store.get(S.lot, first.key)
    expect(back!.values.status).toBe("sold")
    expect(back!.values.commodity).toBe("cod")
  })

  it("rejects filters on non-indexed columns", async () => {
    const store = await make()
    await expect(store.query(S.bid, { reason: "x" })).rejects.toMatchObject({ code: "NotIndexed" })
    await expect(store.query(S.lot, {}, { limit: 101 })).rejects.toMatchObject({ code: "LimitTooHigh" })
  })
}
