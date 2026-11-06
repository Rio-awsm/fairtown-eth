import { describe, expect, it } from "vitest"
import { parseRelayConfig } from "../src/config"

describe("relay config", () => {
  const base = { RELAY_INTERNAL_TOKEN: "t" }

  it("reads CHAIN_BACKFILL_BLOCKS as a block count", () => {
    expect(parseRelayConfig({ ...base, CHAIN_BACKFILL_BLOCKS: "1" }).CHAIN_BACKFILL_BLOCKS).toBe(1n)
  })

  it("leaves it unset so the watcher keeps its 20,000-block default", () => {
    expect(parseRelayConfig(base).CHAIN_BACKFILL_BLOCKS).toBeUndefined()
  })

  it("rejects zero or a non-number, naming the variable", () => {
    expect(() => parseRelayConfig({ ...base, CHAIN_BACKFILL_BLOCKS: "0" })).toThrow(/CHAIN_BACKFILL_BLOCKS/)
    expect(() => parseRelayConfig({ ...base, CHAIN_BACKFILL_BLOCKS: "lots" })).toThrow(/CHAIN_BACKFILL_BLOCKS/)
  })
})
