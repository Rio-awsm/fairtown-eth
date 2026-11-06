import { describe, expect, it } from "vitest"
import { SAMPLE_EVENTS, envelope } from "../test/samples"
import { parseJsonl } from "./jsonl"

const line = (o: unknown) => JSON.stringify(o)

describe("parseJsonl", () => {
  it("parses valid envelopes and skips blank lines", () => {
    const a = envelope(SAMPLE_EVENTS["lot.listed"], "a")
    const b = envelope(SAMPLE_EVENTS["price.tick"], "b")
    const { envelopes, rejected } = parseJsonl(`${line(a)}\n\n${line(b)}\n`)
    expect(envelopes.map((e) => e.id)).toEqual(["a", "b"])
    expect(rejected).toEqual([])
  })

  it("reports a line that is not JSON with its line number and keeps going", () => {
    const a = envelope(SAMPLE_EVENTS.clock, "a")
    const c = envelope(SAMPLE_EVENTS.clock, "c")
    const { envelopes, rejected } = parseJsonl([line(a), "not json", line(c)].join("\n"))
    expect(envelopes.map((e) => e.id)).toEqual(["a", "c"])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.line).toBe(2)
  })

  it("rejects an envelope from a future protocol version", () => {
    const v2 = { ...envelope(SAMPLE_EVENTS.clock, "x"), v: 2 }
    const { envelopes, rejected } = parseJsonl(line(v2))
    expect(envelopes).toEqual([])
    expect(rejected[0]).toMatchObject({ line: 1 })
  })

  it("rejects an envelope whose event breaks the schema", () => {
    const bad = envelope({ ...SAMPLE_EVENTS["lot.settled"], sellerPaid: "2702.70" } as never, "y")
    expect(parseJsonl(line(bad)).rejected).toHaveLength(1)
  })
})
