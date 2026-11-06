import { js as EasyStar } from "easystarjs"
import type { Point } from "../map/anchors"
import type { TiledLayer, TiledMap } from "../map/tiled"

export type Tile = { x: number; y: number }
/** cells[y][x]: 0 walkable, 1 blocked. */
export type WalkGrid = { width: number; height: number; tileWidth: number; tileHeight: number; cells: number[][] }

/** Any tile on these layers blocks people, even if the collision layer forgot it (S3 1.2 key rule). */
const BLOCKS_PEOPLE = ["collision", "water", "buildings"] as const

/** Tile ids of a layer, from CSV arrays or uncompressed base64 (little-endian uint32). */
function layerTiles(layer: TiledLayer | undefined, size: number): number[] {
  if (!layer?.data) return new Array<number>(size).fill(0)
  if (Array.isArray(layer.data)) return layer.data
  const bytes = Uint8Array.from(atob(layer.data), (c) => c.charCodeAt(0))
  return Array.from(new Uint32Array(bytes.buffer, 0, size))
}

function grid(map: TiledMap, isOpen: (i: number) => boolean): WalkGrid {
  const cells = Array.from({ length: map.height }, (_, y) =>
    Array.from({ length: map.width }, (_, x) => (isOpen(y * map.width + x) ? 0 : 1)),
  )
  return { width: map.width, height: map.height, tileWidth: map.tilewidth, tileHeight: map.tileheight, cells }
}

const layer = (map: TiledMap, name: string) =>
  layerTiles(
    map.layers.find((l) => l.name === name),
    map.width * map.height,
  )

/** Where people may walk: everywhere except collision, water and buildings. */
export function buildWalkGrid(map: TiledMap): WalkGrid {
  const blocking = BLOCKS_PEOPLE.map((name) => layer(map, name))
  return grid(map, (i) => blocking.every((tiles) => (tiles[i] ?? 0) === 0))
}

/** Where trucks may drive: road tiles only. */
export function buildRoadGrid(map: TiledMap): WalkGrid {
  const roads = layer(map, "roads")
  return grid(map, (i) => (roads[i] ?? 0) !== 0)
}

export const tileOf = (g: WalkGrid, p: Point): Tile => ({
  x: Math.min(g.width - 1, Math.max(0, Math.floor(p.x / g.tileWidth))),
  y: Math.min(g.height - 1, Math.max(0, Math.floor(p.y / g.tileHeight))),
})
export const centreOf = (g: WalkGrid, t: Tile): Point => ({
  x: t.x * g.tileWidth + g.tileWidth / 2,
  y: t.y * g.tileHeight + g.tileHeight / 2,
})
export const isWalkable = (g: WalkGrid, p: Point): boolean => {
  const t = tileOf(g, p)
  return g.cells[t.y]?.[t.x] === 0
}

/** Breadth-first search outward for the closest open tile. */
export function nearestWalkable(g: WalkGrid, start: Tile): Tile | null {
  const seen = new Set<number>([start.y * g.width + start.x])
  const queue: Tile[] = [start]
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i]!
    if (g.cells[t.y]?.[t.x] === 0) return t
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: t.x + dx, y: t.y + dy }
      const key = n.y * g.width + n.x
      if (n.x < 0 || n.y < 0 || n.x >= g.width || n.y >= g.height || seen.has(key)) continue
      seen.add(key)
      queue.push(n)
    }
  }
  return null
}

export type Pathfinder = {
  /** Tile-centre waypoints from start to end inclusive; [] when already there; null when unreachable. */
  findPath(from: Point, to: Point): Point[] | null
}

/** A* over the grid in 4 directions (agents face 4 ways). Synchronous: the town grid is small. */
export function createPathfinder(g: WalkGrid): Pathfinder {
  const star = new EasyStar()
  star.setGrid(g.cells)
  star.setAcceptableTiles([0])
  star.enableSync()
  return {
    findPath(from, to) {
      const start = nearestWalkable(g, tileOf(g, from))
      const end = nearestWalkable(g, tileOf(g, to))
      if (!start || !end) return null
      let result: Tile[] | null = null
      star.findPath(start.x, start.y, end.x, end.y, (path) => {
        result = path
      })
      star.calculate()
      return result === null ? null : (result as Tile[]).map((t) => centreOf(g, t))
    },
  }
}
