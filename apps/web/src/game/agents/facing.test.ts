import { describe, expect, it } from "vitest"
import { facing } from "./facing"

describe("facing", () => {
  it.each([
    [0, 16, "down"],
    [0, -16, "up"],
    [16, 0, "right"],
    [-16, 0, "left"],
    [16, 4, "right"],
    [3, -10, "up"],
  ] as const)("(%i, %i) faces %s", (dx, dy, expected) => {
    expect(facing(dx, dy)).toBe(expected)
  })

  it("keeps the current facing when not moving", () => {
    expect(facing(0, 0, "left")).toBe("left")
  })
})
