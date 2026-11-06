// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { Models } from "./models"

afterEach(() => vi.restoreAllMocks())

describe("Models", () => {
  it("a model that fails to load becomes a clay stand-in and is listed as failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    )
    const models = new Models("/nowhere/")
    await models.load(["city-commercial/building-a"])
    expect(models.failed).toEqual(["city-commercial/building-a"])
    const o = models.make("city-commercial/building-a", "clay", { w: 4, d: 3, h: 5 })
    const box = new THREE.Box3().setFromObject(o)
    expect(
      box
        .getSize(new THREE.Vector3())
        .toArray()
        .map((v) => Math.round(v)),
    ).toEqual([4, 5, 3])
    expect(box.min.y).toBeCloseTo(0)
    vi.unstubAllGlobals()
  })
  it("a model that was never loaded still draws, as a stand-in, rather than throwing", () => {
    const o = new Models().make("nothing/here", "keep", { h: 1 })
    expect(o.children.length).toBe(1)
  })
})
