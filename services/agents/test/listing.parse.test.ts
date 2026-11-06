import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { SellerMessage } from "@fairtown/shared"
import { parseAiConfig } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { toCanonicalQty } from "../src/listing/catalog"
import { PERSONAS } from "../src/fixtures/personas"
import { parseListing, parseWithRules } from "../src/listing/parse"

const messages = z.array(SellerMessage).parse(JSON.parse(readFileSync(new URL("../../../packages/shared/fixtures/messages.json", import.meta.url), "utf8")))
const view = (p: ReturnType<typeof parseWithRules>) =>
  p && { sector: p.sector, commodity: p.commodity, qty: p.qty.toString(), unit: p.unit, place: p.place, currency: p.currency }

describe("unit conversion in code", () => {
  it.each([
    ["1.2", "tonnes", "fish", 1200n],
    ["30", "quintal", "produce", 3000n],
    ["800", "lb", "fish", 363n],
    ["11000", "lbs", "produce", 4990n],
    ["18,000", "kg", "truck", 18000n],
    ["2", "t", "truck", 2000n],
    ["64", "gpu hrs", "compute", 64n],
    ["20", "slot-days", "storage", 20n],
    ["600", "", "fish", 600n],
    ["0.5", "tonne", "flowers", 500n],
  ] as const)("%s %s (%s) = %s", (amount, unit, sector, want) => {
    expect(toCanonicalQty(amount, unit, sector)).toBe(want)
  })
  it("rejects nonsense", () => {
    expect(toCanonicalQty("abc", "kg", "fish")).toBeNull()
    expect(toCanonicalQty("5", "furlongs", "fish")).toBeNull()
    expect(toCanonicalQty("2", "tonnes", "compute")).toBeNull()
    expect(toCanonicalQty("0", "kg", "fish")).toBeNull()
  })
})

describe("golden seller messages (rules)", () => {
  const results = messages.map((m) => ({ m, got: view(parseWithRules(m.text, PERSONAS.find((x) => x.id === m.sellerId)!.place)) }))
  it("reads at least 18 of 20", () => {
    const ok = results.filter((r) => JSON.stringify(r.got) === JSON.stringify(r.m.expected))
    expect(ok.length).toBeGreaterThanOrEqual(18)
  })
  it.each(results.filter((r) => !r.m.hard).map((r) => [r.m.id, r.m.text, r] as const))("%s: %s", (_id, _t, r) => {
    expect(r.got).toEqual(r.m.expected)
  })
})

describe("parseListing with the LLM", () => {
  it("normalizes the model's raw words in code", async () => {
    const fake = new FakeAi().on("listing", () => ({ commodity: "skrei", quantity: 1.2, unit: "tonnes", place: "Bergen harbour" }))
    const gw = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake })
    const p = await parseListing("Landed 1.2 tonnes of skrei", gw)
    expect(p).toMatchObject({ commodity: "cod", qty: 1200n, place: "bergen", currency: "EUR", market: "fish_dock", source: "llm" })
  })
  it("falls back to rules when the model is wrong or down", async () => {
    const wrong = createGateway({
      config: parseAiConfig({ MOCK_AI: "1" }),
      fake: new FakeAi().on("listing", () => ({ commodity: "unobtainium", quantity: 1, unit: "kg", place: "" })),
    })
    expect(await parseListing("600 kg cod, Bergen", wrong)).toMatchObject({ commodity: "cod", qty: 600n, source: "rules" })
    const down = createGateway({ config: parseAiConfig({ MOCK_AI: "1" }), fake: new FakeAi() })
    expect(await parseListing("3 tonnes tomatoes Lagos", down)).toMatchObject({ commodity: "tomato", qty: 3000n, source: "rules" })
    expect(await parseListing("hello there", down)).toBeNull()
  })
})
