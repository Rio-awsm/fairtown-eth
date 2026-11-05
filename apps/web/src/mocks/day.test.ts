import { readFileSync } from "node:fs"
import { TOWN_EVENT_TYPES } from "@fairtown/shared/protocol"
import { describe, expect, it } from "vitest"
import { parseJsonl } from "../net/jsonl"
import { buildDay, serializeDay } from "./day/build-day"

const file = readFileSync(new URL("./day.jsonl", import.meta.url), "utf8")

describe("temporary day.jsonl (until S2 0.1 ships packages/shared/fixtures/day.jsonl)", () => {
  const { envelopes, rejected } = parseJsonl(file)

  it("parses every line with the shared TownEnvelope schema", () => {
    expect(rejected).toEqual([])
  })

  it("covers every TownEvent type", () => {
    expect(new Set(envelopes.map((e) => e.event.type))).toEqual(new Set(TOWN_EVENT_TYPES))
  })

  it("has at least 60 envelopes and exactly one deliberate duplicate id", () => {
    expect(envelopes.length).toBeGreaterThanOrEqual(60)
    expect(new Set(envelopes.map((e) => e.id)).size).toBe(envelopes.length - 1)
  })

  it("never goes back in time", () => {
    for (let i = 1; i < envelopes.length; i++) expect(envelopes[i]!.ts).toBeGreaterThanOrEqual(envelopes[i - 1]!.ts)
  })

  it("matches buildDay(), so the file cannot drift from the generator", () => {
    expect(file).toBe(serializeDay(buildDay()))
  })
})
