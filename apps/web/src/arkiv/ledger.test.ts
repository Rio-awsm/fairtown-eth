import { describe, expect, it } from "vitest"
import { createMockLedger, unwrapRow, withDayNumber } from "./ledger"
import { emptyLedger } from "./mockLedger"
import { allClears } from "./queries"

describe("unwrapRow", () => {
  it("turns the SDK's typed values into plain bigint and string", () => {
    expect(
      unwrapRow({
        $key: "0x1",
        commodity: { type: "str", value: "cod" },
        avgPerUnit: { type: "u256", value: 9_100_000n },
        day: { type: "u64", value: 3n },
      }),
    ).toEqual({ $key: "0x1", commodity: "cod", avgPerUnit: 9_100_000n, day: 3n })
  })
})

describe("createMockLedger", () => {
  it("answers from the current relay-built ledger, newest first", async () => {
    const ledger = { ...emptyLedger(), price: [] as never[] }
    const client = createMockLedger(() => ledger)
    expect(client.mode).toBe("mock")
    expect(await client.run(allClears(5))).toEqual([])
  })
})

describe("live rows: S2 writes day as YYYY-MM-DD (C 2.2)", () => {
  it("turns the date into days since 1970, the mock ledger's unit", () => {
    expect(withDayNumber({ day: "1970-01-03", lotId: 4n })).toEqual({ day: 2n, lotId: 4n })
    expect(withDayNumber({ day: "2026-11-06" }).day).toBe(BigInt(Math.floor(Date.UTC(2026, 10, 6) / 86_400_000)))
  })

  it("leaves numeric or missing days alone", () => {
    expect(withDayNumber({ day: 3n })).toEqual({ day: 3n })
    expect(withDayNumber({ lotId: 1n })).toEqual({ lotId: 1n })
  })
})
