// @vitest-environment jsdom
import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { Clock } from "./clock"
import { disposeLine, hopPoints, laser, neonLine } from "./lines"

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

describe("neon lines", () => {
  it("draws a line through two or more points, in its colour", () => {
    const line = neonLine([v(0, 0, 0), v(1, 0, 0), v(1, 0, 1)], 0x00e5ff, { dashed: true, width: 4 })
    expect(line).not.toBeNull()
    expect(line!.material.color.getHex()).toBe(0x00e5ff)
    expect(line!.material.dashed).toBe(true)
    expect(line!.material.linewidth).toBe(4)
  })
  it("is no line with fewer than two points", () => {
    expect(neonLine([], 0xffffff)).toBeNull()
    expect(neonLine([v(1, 1, 1)], 0xffffff)).toBeNull()
  })
  it("takes itself out of the scene when disposed", () => {
    const root = new THREE.Group()
    const line = neonLine([v(0, 0, 0), v(1, 0, 0)], 0xffffff)!
    root.add(line)
    disposeLine(line)
    expect(root.children).toHaveLength(0)
  })
  it("hops from a to b, highest in the middle", () => {
    const pts = hopPoints(v(0, 0, 0), v(4, 0, 0), 2, 4)
    expect(pts).toHaveLength(5)
    expect(pts[0]!.toArray()).toEqual([0, 0, 0])
    expect(pts[4]!.x).toBeCloseTo(4)
    expect(pts[4]!.y).toBeCloseTo(0)
    expect(pts[2]!.y).toBeCloseTo(2)
  })
  it("a bid laser shows, then fades and is gone", () => {
    const root = new THREE.Group()
    const clock = new Clock()
    laser({ root, clock, speed: 1 }, v(0, 0.7, 0), v(3, 0.5, 0), 0x00e5ff, 1000)
    expect(root.children).toHaveLength(1)
    clock.advance(1000)
    expect(root.children).toHaveLength(0)
  })
})
