import { describe, expect, it } from "vitest"
import { ndcToCanvas, toMap, toWorld } from "./coords"

describe("coords", () => {
  it("one map tile (16 px) is one world unit; map y runs along world z", () => {
    expect(toWorld({ x: 32, y: 48 })).toEqual({ x: 2, z: 3 })
    expect(toMap({ x: 2, z: 3 })).toEqual({ x: 32, y: 48 })
  })
  it("maps device coordinates onto the 1920 × 1080 canvas space the tests use", () => {
    expect(ndcToCanvas({ x: -1, y: 1 })).toEqual({ x: 0, y: 0 })
    expect(ndcToCanvas({ x: 1, y: -1 })).toEqual({ x: 1920, y: 1080 })
    expect(ndcToCanvas({ x: 0, y: 0 })).toEqual({ x: 960, y: 540 })
  })
})
