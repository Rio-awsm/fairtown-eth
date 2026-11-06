import { describe, expect, it } from "vitest"
import { MARKET_BUILDINGS, REQUIRED_ANCHORS, anchorFor, parseTownMap } from "./anchors"
import { buildStubMap } from "./stub-map"

type Json = ReturnType<typeof buildStubMap>
const clone = (): Json => structuredClone(buildStubMap())
const anchorsLayer = (m: Json) => m.layers.find((l) => l.name === "anchors")!
const problemsOf = (m: unknown) => {
  const r = parseTownMap(m)
  if (r.ok) throw new Error("expected problems")
  return r.problems
}

describe("REQUIRED_ANCHORS", () => {
  it("lists entry, label, 6 stalls and 8 queue spots for each of the 7 buildings, the gate spawn and road_1", () => {
    expect(MARKET_BUILDINGS).toHaveLength(7)
    expect(REQUIRED_ANCHORS).toHaveLength(7 * 16 + 2)
    expect(REQUIRED_ANCHORS).toContain("fish_dock.stall_6")
    expect(REQUIRED_ANCHORS).toContain("compute_yard.queue_8")
    expect(REQUIRED_ANCHORS).toContain("town_gate.spawn")
    expect(REQUIRED_ANCHORS).toContain("road_1")
  })
})

describe("parseTownMap", () => {
  it("accepts a complete map and returns typed anchors in pixels", () => {
    const r = parseTownMap(buildStubMap())
    if (!r.ok) throw new Error(r.problems.join("\n"))
    expect(r.value.widthPx).toBe(60 * 16)
    expect(r.value.heightPx).toBe(34 * 16)
    expect(r.value.anchors.buildings.fish_dock.stalls).toHaveLength(6)
    expect(r.value.anchors.buildings.fish_dock.queue).toHaveLength(8)
    expect(r.value.anchors.roads.length).toBeGreaterThanOrEqual(1)
    expect(anchorFor(r.value.anchors, "town_gate")).toEqual(r.value.anchors.gateSpawn)
    expect(anchorFor(r.value.anchors, "fish_dock")).toEqual(r.value.anchors.buildings.fish_dock.entry)
  })

  it("names a missing anchor", () => {
    const m = clone()
    const layer = anchorsLayer(m)
    layer.objects = layer.objects!.filter((o) => o.name !== "fish_dock.stall_3")
    expect(problemsOf(m)).toEqual(["missing anchor fish_dock.stall_3"])
  })

  it("reports every missing anchor at once", () => {
    const m = clone()
    anchorsLayer(m).objects = []
    expect(problemsOf(m)).toHaveLength(REQUIRED_ANCHORS.length)
  })

  it("names a duplicate anchor", () => {
    const m = clone()
    const layer = anchorsLayer(m)
    layer.objects!.push({ ...layer.objects![0]!, id: 9999 })
    expect(problemsOf(m)).toEqual([`duplicate anchor ${layer.objects![0]!.name}`])
  })

  it("names an anchor outside the map", () => {
    const m = clone()
    const spawn = anchorsLayer(m).objects!.find((o) => o.name === "town_gate.spawn")!
    spawn.x = 5000
    expect(problemsOf(m)).toEqual(["anchor town_gate.spawn is outside the map"])
  })

  it("names a missing layer", () => {
    const m = clone()
    m.layers = m.layers.filter((l) => l.name !== "collision")
    expect(problemsOf(m)).toEqual(["missing tile layer collision"])
  })

  it("rejects an external tileset, which Phaser cannot load", () => {
    const m = clone()
    m.tilesets = [{ firstgid: 1, source: "tiny-town.tsx" }] as unknown as Json["tilesets"]
    expect(problemsOf(m)[0]).toMatch(/tileset tiny-town.tsx is external: embed it in Tiled/)
  })

  it("rejects a compressed tile layer", () => {
    const m = clone()
    const ground = m.layers.find((l) => l.name === "ground")!
    Object.assign(ground, { encoding: "base64", compression: "zstd", data: "AAAA" })
    expect(problemsOf(m)).toEqual(["layer ground is compressed (zstd): set Tile Layer Format to CSV"])
  })

  it("rejects something that is not a Tiled map", () => {
    expect(problemsOf({ hello: "world" })[0]).toMatch(/not a Tiled map/)
  })

  it("uses the centre of a rectangle anchor", () => {
    const m = clone()
    const spawn = anchorsLayer(m).objects!.find((o) => o.name === "town_gate.spawn")!
    Object.assign(spawn, { x: 100, y: 200, width: 32, height: 16, point: false })
    const r = parseTownMap(m)
    expect(r.ok && r.value.anchors.gateSpawn).toEqual({ x: 116, y: 208 })
  })
})
