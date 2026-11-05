import { SellerMessage } from "@fairtown/shared"
import { loadEnv } from "@fairtown/shared/env"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { parseAiConfig } from "../../src/ai/config"
import { createGateway } from "../../src/ai/gateway"
import { PERSONAS } from "../../src/fixtures/personas"
import { parseListing } from "../../src/listing/parse"

const { env } = loadEnv(new URL("../../../../.env", import.meta.url).pathname)
const gw = createGateway({ config: parseAiConfig({ ...env, MOCK_AI: "0" }), defaultTimeoutMs: 15_000 })
const messages = z.array(SellerMessage).parse(JSON.parse(readFileSync(new URL("../../../../packages/shared/fixtures/messages.json", import.meta.url), "utf8")))

describe("listing parse live", () => {
  it("reads at least 18 of 20 golden messages with the real model", async () => {
    const results = await Promise.all(
      messages.map(async (m) => {
        const home = PERSONAS.find((x) => x.id === m.sellerId)!.place
        const p = await parseListing(m.text, gw, home)
        const got = p && { sector: p.sector, commodity: p.commodity, qty: p.qty.toString(), unit: p.unit, place: p.place, currency: p.currency }
        return { id: m.id, ok: JSON.stringify(got) === JSON.stringify(m.expected), source: p?.source, got, want: m.expected }
      }),
    )
    for (const r of results.filter((x) => !x.ok)) console.log("miss", r.id, r.got, "want", r.want)
    console.log("llm:", results.filter((r) => r.source === "llm").length, "rules:", results.filter((r) => r.source === "rules").length, "ok:", results.filter((r) => r.ok).length, "stats:", gw.stats().listing)
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(18)
  }, 60_000)
})
