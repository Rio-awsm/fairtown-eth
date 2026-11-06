import { describe, expect, it } from "vitest"
import { buildBuyerRequest, parseSelectParam, type BuyerForm } from "./model"

const form = (over: Partial<BuyerForm> = {}): BuyerForm => ({
  name: "Hanse Kitchen",
  role: "BUYER",
  currency: "EUR",
  commodities: ["cod", "haddock"],
  maxPerUnit: "9.40",
  qty: "600",
  minGrade: "fresh_a",
  place: "",
  budget: "50000",
  avoidNoShowSellers: true,
  ...over,
})

describe("buildBuyerRequest", () => {
  it("turns the form into the API body with money in base units", () => {
    expect(buildBuyerRequest(form())).toEqual({
      ok: true,
      body: {
        name: "Hanse Kitchen",
        role: "BUYER",
        currency: "EUR",
        mandate: {
          commodities: ["cod", "haddock"],
          maxPerUnit: "9400000",
          qty: "600",
          minGrade: "fresh_a",
          avoidNoShowSellers: true,
        },
        budget: "50000000000",
      },
    })
  })

  it("leaves out optional fields that are empty", () => {
    const r = buildBuyerRequest(form({ qty: "", minGrade: "", place: "lagos" }))
    expect(r.ok && r.body.mandate).toEqual({
      commodities: ["cod", "haddock"],
      maxPerUnit: "9400000",
      place: "lagos",
      avoidNoShowSellers: true,
    })
  })

  it("names every problem in plain words", () => {
    const r = buildBuyerRequest(form({ name: " ", commodities: [], maxPerUnit: "abc", qty: "1.5", budget: "" }))
    expect(r).toEqual({
      ok: false,
      errors: {
        name: "Give the buyer a name",
        commodities: "Pick at least one thing to buy",
        maxPerUnit: "Enter a price like 7.50",
        qty: "Use a whole number",
        budget: "Enter a budget",
      },
    })
  })

  it("refuses a budget smaller than max price times quantity", () => {
    expect(buildBuyerRequest(form({ budget: "5000" }))).toEqual({
      ok: false,
      errors: { budget: "The budget is less than max price × quantity (€5,640.00)" },
    })
  })

  it("keeps money exact for large budgets", () => {
    const r = buildBuyerRequest(form({ budget: "123456789012.345678", qty: "" }))
    expect(r.ok && r.body.budget).toBe("123456789012345678")
  })
})

describe("parseSelectParam", () => {
  it.each([
    ["agent:0xabc", { kind: "agent", id: "0xabc" }],
    ["lot:12", { kind: "lot", id: "12" }],
    ["building:fish_dock", { kind: "building", id: "fish_dock" }],
    ["building:moon", null],
    ["nonsense", null],
    [null, null],
  ] as const)("%s", (param, selection) => {
    expect(parseSelectParam(param)).toEqual(selection)
  })
})
