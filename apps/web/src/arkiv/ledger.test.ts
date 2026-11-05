import { describe, expect, it } from "vitest"
import { createMockLedger, unwrapRow } from "./ledger"
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
