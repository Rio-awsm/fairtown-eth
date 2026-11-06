import { loadEnv } from "@fairtown/shared/env"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { parseAiConfig } from "../../src/ai/config"
import { createGateway } from "../../src/ai/gateway"

// Opt-in: pnpm -F agents test:live. Uses the real endpoints and models from the root .env.
const { env } = loadEnv(new URL("../../../../.env", import.meta.url).pathname)
const gw = createGateway({ config: parseAiConfig({ ...env, MOCK_AI: "0" }), defaultTimeoutMs: 15_000 })
const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC"

describe("AI gateway live", () => {
  it("health lists every role's model", async () => {
    const h = await gw.health()
    console.log("health:", h.detail)
    expect(h.ok).toBe(true)
  })

  it("listing parses a seller message", async () => {
    const r = await gw.decide("listing", {
      system: "Extract the listing. Quantities in kilograms.",
      prompt: "600 kg cod, landed 04:40, Bergen",
      schema: z.object({ commodity: z.string(), qty: z.number(), place: z.string() }),
    })
    console.log("listing:", r.attempt, `${r.ms}ms`, r.value)
    expect(r.value.commodity.toLowerCase()).toContain("cod")
    expect(r.value.qty).toBe(600)
  })

  it("bidder returns a Decision-shaped answer", async () => {
    const r = await gw.decide("bidder", {
      system: "You are a cautious fish buyer. Max price 9.40 EUR/kg.",
      prompt: "Cod, grade A, clearing 9.10 EUR/kg, 600 kg. Bid or pass? Prices as decimal strings of 6-decimal base units.",
      schema: z.object({ action: z.enum(["bid", "pass"]), maxPerUnit: z.string().regex(/^\d+$/).optional(), reason: z.string().max(80) }),
    })
    console.log("bidder:", r.attempt, `${r.ms}ms`, r.value)
    expect(["bid", "pass"]).toContain(r.value.action)
  })

  it("vision reads an image", async () => {
    const r = await gw.decide("vision", {
      system: "Describe images briefly.",
      prompt: "What is the dominant colour?",
      images: [{ data: RED_PNG, mediaType: "image/png" }],
      schema: z.object({ colour: z.string() }),
    })
    console.log("vision:", r.attempt, `${r.ms}ms`, r.value, "trace:", r.trace ?? "none")
    expect(r.value.colour.toLowerCase()).toContain("red")
  })
})

