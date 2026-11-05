import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import { ArkivError, type ArkivEvent, type SchemaRef } from "../src/arkiv/ArkivStore"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"

const lot: SchemaRef = { name: "fairtown.v1.lot", indexed: ["commodity", "status", "lotId", "floorPerUnit"] }
const owner = "0x00000000000000000000000000000000000000a1" as Address
const other = "0x00000000000000000000000000000000000000b2" as Address

function store() {
  let t = 1_000_000
  const s = new MemoryArkivStore(() => t)
  return { s, tick: (sec: number) => (t += sec * 1000) }
}
const errCode = async (p: Promise<unknown>) => p.then(() => "no error", (e) => (e instanceof ArkivError ? e.code : String(e)))

describe("MemoryArkivStore", () => {
  it("writes and reads back by indexed filters and ranges", async () => {
    const { s } = store()
    await s.put(lot, { commodity: "cod", status: "open", lotId: 1n, floorPerUnit: 7_500_000n }, { owner, expiresInSeconds: 60 })
    await s.put(lot, { commodity: "cod", status: "sold", lotId: 2n, floorPerUnit: 9_000_000n }, { owner, expiresInSeconds: 60 })
    await s.put(lot, { commodity: "rose", status: "open", lotId: 3n, floorPerUnit: 1_000_000n }, { owner, expiresInSeconds: 60 })
    const cod = await s.query(lot, { commodity: "cod" })
    expect(cod.entities.map((e) => e.values.lotId)).toEqual([1n, 2n])
    const cheap = await s.query(lot, { floorPerUnit: { lt: 8_000_000n } }, { orderBy: { field: "lotId", dir: "desc" } })
    expect(cheap.entities.map((e) => e.values.lotId)).toEqual([3n, 1n])
  })

  it("pages at 100 rows with a cursor", async () => {
    const { s } = store()
    for (let i = 0; i < 150; i++) await s.put(lot, { commodity: "cod", lotId: BigInt(i) }, { owner, expiresInSeconds: 60 })
    const p1 = await s.query(lot, { commodity: "cod" })
    expect(p1.entities).toHaveLength(100)
    const p2 = await s.query(lot, { commodity: "cod" }, { cursor: p1.cursor })
    expect(p2.entities).toHaveLength(50)
    expect(p2.cursor).toBeUndefined()
  })

  it("mirrors Rabdi limits", async () => {
    const { s } = store()
    expect(await errCode(s.query(lot, { grade: "a" }))).toBe("NotIndexed")
    expect(await errCode(s.query(lot, {}, { orderBy: { field: "grade", dir: "asc" } }))).toBe("NotIndexed")
    expect(await errCode(s.query(lot, {}, { limit: 101 }))).toBe("LimitTooHigh")
    expect(await errCode(s.put(lot, { details: new Uint8Array(100 * 1024 + 1) }, { owner, expiresInSeconds: 1 }))).toBe(
      "PayloadTooLarge",
    )
  })

  it("only lets the owner replace an entity", async () => {
    const { s } = store()
    const { key } = await s.put(lot, { status: "open" }, { owner, expiresInSeconds: 60 })
    expect(await errCode(s.put(lot, { status: "sold" }, { owner: other, expiresInSeconds: 60, key }))).toBe("NotOwner")
    await s.put(lot, { status: "sold" }, { owner, expiresInSeconds: 60, key })
    expect((await s.query(lot, { status: "sold" })).entities).toHaveLength(1)
  })

  it("expires silently and extends", async () => {
    const { s, tick } = store()
    const events: ArkivEvent[] = []
    s.watch((e) => events.push(e))
    const a = await s.put(lot, { status: "open" }, { owner, expiresInSeconds: 10 })
    await s.put(lot, { status: "open" }, { owner, expiresInSeconds: 10 })
    await s.extend(a.key, 30)
    expect(await errCode(s.extend(a.key, 5))).toBe("ExpiryEarlier")
    tick(11)
    const left = await s.query(lot, { status: "open" })
    expect(left.entities.map((e) => e.key)).toEqual([a.key])
    expect(events.map((e) => e.type)).toEqual(["created", "created", "extended"])
    expect(Object.keys(events[0]!)).toEqual(["type", "key", "owner", "at"])
  })
})
