import { GID, TILE, TILE_NAMES, grassAt } from "../art/tiles"
import type { MarketBuilding } from "./anchors"
import type { TiledMap } from "./tiled"

/**
 * The generated town.tmj (until a hand-built Tiled map lands), and the fallback layout when the
 * real map fails to load. 60 × 34 tiles of 16 px, drawn at 2× to fill 1920 × 1080.
 * Tiles come from src/game/art/tiles.ts; buildings and props are sprites drawn by the scene.
 */
export const STUB_W = 60
export const STUB_H = 34
export { TILE }
export const STUB_TILESET_NAME = "fairtown-town"
export const STUB_TILESET_IMAGE = "../tiles/fairtown-town.png"

/** Tile ids the layout uses (gid = index + 1 in fairtown-town.png). */
export const STUB_TILES = GID

/** Top-left tile and size of each building footprint, shared with the building sprites. */
export const BUILDING_FOOTPRINT = { w: 8, h: 5 } as const

/** Top-left tile of each 8 × 5 building, after the source of truth 13 sketch. */
const BUILDING_AT: Record<MarketBuilding, [number, number]> = {
  fish_dock: [4, 6],
  freight_yard: [46, 4],
  flower_hall: [12, 15],
  compute_yard: [34, 14],
  cold_vault: [48, 14],
  harvest_hall: [4, 24],
  neighbourhood_pool: [46, 24],
}
const BW = BUILDING_FOOTPRINT.w
const BH = BUILDING_FOOTPRINT.h

type Grid = number[]
const grid = (fill = 0): Grid => new Array<number>(STUB_W * STUB_H).fill(fill)
const rect = (g: Grid, x0: number, y0: number, w: number, h: number, gid: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[y * STUB_W + x] = gid
}
const px = (tiles: number) => tiles * TILE

export function buildStubMap() {
  const ground = grid(STUB_TILES.grass)
  for (let y = 0; y < STUB_H; y++) for (let x = 0; x < STUB_W; x++) ground[y * STUB_W + x] = grassAt(x, y)
  rect(ground, 0, 4, 30, 1, STUB_TILES.shore)
  const water = grid()
  const roads = grid()
  const buildings = grid()
  const decor = grid()
  const collision = grid()

  rect(water, 0, 0, 30, 3, STUB_TILES.water)
  rect(water, 0, 3, 30, 1, STUB_TILES.water_edge)
  rect(collision, 0, 0, 30, 4, STUB_TILES.block)
  rect(roads, 0, 22, STUB_W, 1, STUB_TILES.road)
  rect(roads, 30, 4, 1, STUB_H - 4, STUB_TILES.road)
  for (const [bx, by] of Object.values(BUILDING_AT)) {
    rect(buildings, bx, by, BW, BH, STUB_TILES.wall)
    rect(buildings, bx, by, BW, 2, STUB_TILES.roof)
    rect(collision, bx, by, BW, BH, STUB_TILES.block)
  }
  rect(decor, 7, 1, 2, 4, STUB_TILES.planks) // jetty at the Bergen dock
  rect(decor, 28, 31, 5, 1, STUB_TILES.planks) // town gate threshold

  let id = 1
  const point = (name: string, tx: number, ty: number) => ({
    id: id++,
    name,
    type: "",
    point: true,
    x: px(tx),
    y: px(ty),
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
  })
  const objects = Object.entries(BUILDING_AT).flatMap(([b, [bx, by]]) => [
    point(`${b}.entry`, bx + BW / 2, by + BH + 0.5),
    point(`${b}.label`, bx + BW / 2, by - 0.5),
    ...Array.from({ length: 6 }, (_, i) => point(`${b}.stall_${i + 1}`, bx + i + 1.5, by + BH + 1.5)),
    ...Array.from({ length: 8 }, (_, i) => point(`${b}.queue_${i + 1}`, bx + i + 0.5, by + BH + 3.5)),
  ])
  objects.push(
    point("town_gate.spawn", 30.5, 32.5),
    point("road_1", 30.5, 5.5),
    point("road_2", 30.5, 22.5),
    point("road_3", 8.5, 22.5),
    point("road_4", 50.5, 22.5),
    point("road_5", 30.5, 30.5),
  )

  const tileLayer = (lid: number, name: string, data: Grid) => ({
    id: lid,
    name,
    type: "tilelayer",
    width: STUB_W,
    height: STUB_H,
    x: 0,
    y: 0,
    opacity: 1,
    visible: name !== "collision",
    data,
  })

  const map = {
    type: "map",
    version: "1.10",
    tiledversion: "1.11.0",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: STUB_W,
    height: STUB_H,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 8,
    nextobjectid: id,
    properties: [{ name: "fairtown_stub", type: "bool", value: true }],
    layers: [
      tileLayer(1, "ground", ground),
      tileLayer(2, "water", water),
      tileLayer(3, "roads", roads),
      tileLayer(4, "buildings", buildings),
      tileLayer(5, "decor", decor),
      tileLayer(6, "collision", collision),
      { id: 7, name: "anchors", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, objects },
    ] as TiledMap["layers"],
    tilesets: [
      {
        firstgid: 1,
        name: STUB_TILESET_NAME,
        image: STUB_TILESET_IMAGE,
        imagewidth: TILE * TILE_NAMES.length,
        imageheight: TILE,
        tilewidth: TILE,
        tileheight: TILE,
        tilecount: TILE_NAMES.length,
        columns: TILE_NAMES.length,
        margin: 0,
        spacing: 0,
      },
    ] as TiledMap["tilesets"],
  }
  return map satisfies TiledMap
}
