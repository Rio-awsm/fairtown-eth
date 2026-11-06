import { describe, expect, it } from "vitest"
import { chartData } from "./PriceChart"

describe("chartData", () => {
  it("turns the price log into block and price series", () => {
    expect(
      chartData([
        { block: 1046, perUnit: "8100000" },
        { block: 1050, perUnit: "8700000" },
      ]),
    ).toEqual([
      [1046, 1050],
      [8.1, 8.7],
    ])
  })
})
