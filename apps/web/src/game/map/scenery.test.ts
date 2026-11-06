import { describe, expect, it } from "vitest"
import { buildRoadGrid, buildWalkGrid } from "../agents/pathing"
import { MARKET_BUILDINGS, parseTownMap } from "./anchors"
import { layoutScenery, reservedTiles } from "./scenery"
import { buildStubMap } from "./stub-map"

const raw = buildStubMap()
const parsed = parseTownMap(raw)
if (!parsed.ok) throw new Error(parsed.problems.join("; "))
const town = parsed.value
const walk = buildWalkGrid(raw)
const roads = buildRoadGrid(raw)
const props = layoutScenery(town, walk, roads)
const tileOf = (p: { x: number; y: number }) => `${Math.floor(p.x / 16)},${Math.floor(p.y / 16)}`

describe("layoutScenery", () => {
  it("dresses the town with trees, bushes and street lamps", () => {
    const kinds = new Set(props.map((p) => p.kind))
    expect([...kinds].sort()).toEqual(["bush", "lamp", "pine", "tree"])
    expect(props.filter((p) => p.kind !== "lamp").length).toBeGreaterThan(30)
  })

  it("never puts a prop on water, a wall, a road, a stall, a queue spot or the gate", () => {
    const reserved = reservedTiles(town, walk, roads)
    for (const p of props) {
      expect(walk.cells[p.ty]![p.tx], `${p.kind} at ${p.tx},${p.ty} on water or wall`).toBe(0)
      expect(roads.cells[p.ty]![p.tx], `${p.kind} at ${p.tx},${p.ty} on a road`).toBe(1)
      if (p.kind !== "lamp") expect(reserved.has(`${p.tx},${p.ty}`)).toBe(false)
    }
    const busy = new Set(
      MARKET_BUILDINGS.flatMap((b) => {
        const a = town.anchors.buildings[b]
        return [a.entry, ...a.stalls, ...a.queue].map(tileOf)
      }),
    )
    busy.add(tileOf(town.anchors.gateSpawn))
    for (const p of props) expect(busy.has(`${p.tx},${p.ty}`), `${p.kind} at ${p.tx},${p.ty}`).toBe(false)
  })

  it("is the same every time, and sorted back to front", () => {
    expect(layoutScenery(town, walk, roads)).toEqual(props)
    const ys = props.map((p) => p.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  it("places nothing on a map with no free ground", () => {
    const blocked = { ...walk, cells: walk.cells.map((row) => row.map(() => 1)) }
    expect(layoutScenery(town, blocked, roads).filter((p) => p.kind !== "lamp")).toEqual([])
  })
})
