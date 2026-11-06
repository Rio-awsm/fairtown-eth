import { describe, expect, it } from "vitest"
import type { TownCommand } from "../game/commands"
import { mergeLog, walkBeforeBid } from "./liveOrder"

describe("mergeLog", () => {
  it("appends only the new tail of an overlapping window", () => {
    expect(mergeLog([1, 2, 3], [2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5])
  })

  it("keeps everything when the window has slid past the old log", () => {
    expect(mergeLog([1, 2], [3, 4])).toEqual([1, 2, 3, 4])
  })

  it("adds nothing when the window has not changed", () => {
    expect(mergeLog([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3])
  })

  it("starts from an empty log", () => {
    expect(mergeLog([], [7, 8])).toEqual([7, 8])
  })
})

const walk = (agentId: string): TownCommand => ({ kind: "walkTo", agentId, building: "fish_dock" })
const coin = (agentId: string, lotId = "6"): TownCommand => ({ kind: "coinArc", lotId, agentId })

describe("walkBeforeBid", () => {
  it("passes when every bidder walked first", () => {
    const r = walkBeforeBid([walk("a"), walk("b"), coin("a"), coin("b"), coin("a")], "6")
    expect(r).toEqual({ bids: 3, bidders: ["a", "b"], walkers: ["a", "b"], violations: [] })
  })

  it("flags a bid that landed before its agent walked", () => {
    expect(walkBeforeBid([coin("a"), walk("a")], "6").violations).toEqual(["a"])
  })

  it("ignores bids on other lots", () => {
    expect(walkBeforeBid([coin("a", "5")], "6")).toMatchObject({ bids: 0, violations: [] })
  })
})
