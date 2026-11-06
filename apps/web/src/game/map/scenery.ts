import { rng } from "../art/pix"
import type { WalkGrid } from "../agents/pathing"
import { MARKET_BUILDINGS, type Point, type TownMap } from "./anchors"

export type PropKind = "tree" | "pine" | "bush" | "lamp"
/** A prop stands on a tile; x, y are the bottom centre of that tile in world pixels. */
export type Prop = { kind: PropKind; tx: number; ty: number; x: number; y: number; variant: number }

/** Building footprint in world pixels, from its label (above) and entry (below) anchors. */
export function footprintOf(town: TownMap, b: (typeof MARKET_BUILDINGS)[number]) {
  const { label, entry } = town.anchors.buildings[b]
  return { x: label.x - 64, y: label.y + 8, w: 128, h: entry.y - label.y - 16 }
}

/**
 * Tiles where nothing may stand: water and walls (from the walk grid), roads and their kerbs,
 * a margin round each building, the stall and queue rows in front of it, and the town gate.
 */
export function reservedTiles(town: TownMap, walk: WalkGrid, roads: WalkGrid, kerbs = true): Set<string> {
  const out = new Set<string>()
  const t = town.tileWidth
  const mark = (tx: number, ty: number) => out.add(`${tx},${ty}`)
  const markPx = (p: Point, r = 1) => {
    const tx = Math.floor(p.x / t)
    const ty = Math.floor(p.y / t)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) mark(tx + dx, ty + dy)
  }
  for (let y = 0; y < walk.height; y++)
    for (let x = 0; x < walk.width; x++) {
      if (walk.cells[y]![x] === 1) mark(x, y)
      // Water's edge: keep the shoreline clear too.
      if (walk.cells[y - 1]?.[x] === 1 && walk.cells[y]![x] === 0) mark(x, y)
      // Road grid: 0 is road (drivable), 1 is not.
      if (roads.cells[y]![x] !== 0 || !kerbs) continue
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mark(x + dx, y + dy)
    }
  for (const b of MARKET_BUILDINGS) {
    const f = footprintOf(town, b)
    const x0 = Math.floor(f.x / t) - 2
    const y0 = Math.floor(f.y / t) - 3
    const x1 = Math.ceil((f.x + f.w) / t) + 1
    const y1 = Math.ceil((f.y + f.h) / t) + 5
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mark(x, y)
    const a = town.anchors.buildings[b]
    for (const p of [a.entry, ...a.stalls, ...a.queue]) markPx(p)
  }
  markPx(town.anchors.gateSpawn, 4)
  for (const p of town.anchors.roads) markPx(p)
  return out
}

/** Trees, bushes and street lamps, placed by a fixed seed on tiles nobody needs. */
export function layoutScenery(town: TownMap, walk: WalkGrid, roads: WalkGrid, seed = 7): Prop[] {
  const reserved = reservedTiles(town, walk, roads)
  // Lamps stand on the kerb, so they only avoid buildings, stalls, queues and the gate.
  const kerbside = reservedTiles(town, walk, roads, false)
  const taken = new Set<string>()
  const free = (tx: number, ty: number) =>
    tx >= 0 &&
    ty >= 0 &&
    tx < walk.width &&
    ty < walk.height &&
    !reserved.has(`${tx},${ty}`) &&
    !taken.has(`${tx},${ty}`)
  const t = town.tileWidth
  const props: Prop[] = []
  const put = (kind: PropKind, tx: number, ty: number, variant: number, room: number) => {
    for (let dy = -room; dy <= 0; dy++) for (let dx = -room; dx <= room; dx++) if (!free(tx + dx, ty + dy)) return
    for (let dy = -room - 1; dy <= 1; dy++)
      for (let dx = -room - 1; dx <= room + 1; dx++) taken.add(`${tx + dx},${ty + dy}`)
    props.push({ kind, tx, ty, x: tx * t + t / 2, y: (ty + 1) * t, variant })
  }

  // Street lamps along the kerbs, every eight tiles.
  for (let y = 0; y < roads.height; y++)
    for (let x = 0; x < roads.width; x++) {
      if (roads.cells[y]![x] !== 0 || (x + y) % 8 !== 0) continue
      for (const [dx, dy] of [
        [0, -1],
        [-1, 0],
      ] as const) {
        const key = `${x + dx},${y + dy}`
        if (roads.cells[y + dy]?.[x + dx] !== 1 || kerbside.has(key) || taken.has(key)) continue
        props.push({ kind: "lamp", tx: x + dx, ty: y + dy, x: (x + dx) * t + t / 2, y: (y + dy + 1) * t, variant: 0 })
        taken.add(key)
      }
    }

  const r = rng(seed)
  for (let y = 1; y < walk.height; y++)
    for (let x = 0; x < walk.width; x++) {
      const roll = r()
      const edge = x < 2 || x > walk.width - 3 || y > walk.height - 3
      if (roll < (edge ? 0.5 : 0.07)) put(r() < 0.25 ? "pine" : "tree", x, y, Math.floor(r() * 3), 1)
      else if (roll < (edge ? 0.6 : 0.1)) put("bush", x, y, 0, 0)
    }
  // Draw back to front so lower props overlap the ones behind them.
  return props.sort((a, b) => a.y - b.y || a.x - b.x)
}
