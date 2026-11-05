import { describe, expect, it } from "vitest"
import { parseTownMap, type TownAnchors } from "../map/anchors"
import { buildStubMap } from "../map/stub-map"
import { buildRoadGrid, buildWalkGrid, createPathfinder, isWalkable, tileOf, type WalkGrid } from "./pathing"

const map = buildStubMap()
const parsed = parseTownMap(map)
if (!parsed.ok) throw new Error(parsed.problems.join("; "))
const anchors: TownAnchors = parsed.value.anchors
const walk = buildWalkGrid(map)
const roads = buildRoadGrid(map)

const adjacent = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 16

describe("buildWalkGrid", () => {
  it("blocks water and buildings and leaves grass open", () => {
    expect(walk.cells[0]![0]).toBe(1) // sea
    expect(walk.cells[7]![5]).toBe(1) // Fish Dock walls
    expect(walk.cells[20]![25]).toBe(0) // grass
  })

  it("blocks a building tile even when the collision layer forgot it", () => {
    const m = structuredClone(map)
    const collision = m.layers.find((l) => l.name === "collision")!
    collision.data = (collision.data as number[]).map(() => 0)
    expect(buildWalkGrid(m).cells[7]![5]).toBe(1)
  })

  it("reads base64 layer data the same as CSV", () => {
    const m = structuredClone(map)
    for (const layer of m.layers) {
      if (!Array.isArray(layer.data)) continue
      const bytes = new Uint8Array(new Uint32Array(layer.data).buffer)
      Object.assign(layer, { encoding: "base64", data: btoa(String.fromCharCode(...bytes)) })
    }
    expect(buildWalkGrid(m).cells).toEqual(walk.cells)
  })

  it("only opens road tiles for trucks", () => {
    expect(roads.cells[22]![5]).toBe(0)
    expect(roads.cells[20]![25]).toBe(1)
  })
})

describe("createPathfinder", () => {
  const pf = createPathfinder(walk)

  it("walks from Fish Dock to Freight Yard in 4-neighbour steps, never through water or buildings", () => {
    const from = anchors.buildings.fish_dock.entry
    const to = anchors.buildings.freight_yard.queue[3]!
    const path = pf.findPath(from, to)
    expect(path).not.toBeNull()
    expect(path!.length).toBeGreaterThan(10)
    for (const p of path!) expect(isWalkable(walk, p)).toBe(true)
    for (let i = 1; i < path!.length; i++) expect(adjacent(path![i - 1]!, path![i]!)).toBe(true)
    expect(tileOf(walk, path!.at(-1)!)).toEqual(tileOf(walk, to))
  })

  it("returns an empty path when already on the target tile", () => {
    const at = anchors.buildings.fish_dock.entry
    expect(pf.findPath(at, at)).toEqual([])
  })

  it("snaps a target inside a building to the nearest open tile", () => {
    const path = pf.findPath(anchors.buildings.fish_dock.entry, { x: 5 * 16 + 8, y: 7 * 16 + 8 })
    expect(path).not.toBeNull()
    expect(isWalkable(walk, path!.at(-1)!)).toBe(true)
  })

  it("returns null when the target is walled in", () => {
    const g: WalkGrid = {
      width: 5,
      height: 5,
      tileWidth: 16,
      tileHeight: 16,
      cells: [
        [0, 0, 0, 0, 0],
        [0, 1, 1, 1, 0],
        [0, 1, 0, 1, 0],
        [0, 1, 1, 1, 0],
        [0, 0, 0, 0, 0],
      ],
    }
    expect(createPathfinder(g).findPath({ x: 8, y: 8 }, { x: 40, y: 40 })).toBeNull()
  })

  it("keeps a truck on the roads", () => {
    const trucks = createPathfinder(roads)
    const path = trucks.findPath(anchors.buildings.fish_dock.entry, anchors.buildings.freight_yard.entry)
    expect(path).not.toBeNull()
    for (const p of path!) expect(isWalkable(roads, p)).toBe(true)
  })
})
