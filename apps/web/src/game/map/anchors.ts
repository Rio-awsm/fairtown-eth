import { BUILDINGS, type Building } from "@fairtown/shared/keys"
import { TiledMap, type TiledObject } from "./tiled"

export type Point = { x: number; y: number }
export type MarketBuilding = Exclude<Building, "town_gate">
export type BuildingAnchors = { entry: Point; label: Point; stalls: Point[]; queue: Point[] }
export type TownAnchors = { buildings: Record<MarketBuilding, BuildingAnchors>; gateSpawn: Point; roads: Point[] }
export type TownMap = { widthPx: number; heightPx: number; tileWidth: number; tileHeight: number; anchors: TownAnchors }
export type MapResult = { ok: true; value: TownMap } | { ok: false; problems: string[] }

export const MARKET_BUILDINGS = BUILDINGS.filter((b): b is MarketBuilding => b !== "town_gate")
export const STALLS = 6
export const QUEUE_SPOTS = 8
/** Layer names the scene creates, in draw order. `collision` is hidden. */
export const TILE_LAYERS = ["ground", "water", "roads", "buildings", "decor", "collision"] as const
export const ANCHOR_LAYER = "anchors"

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
const perBuilding = (b: MarketBuilding) => [
  `${b}.entry`,
  `${b}.label`,
  ...range(STALLS).map((i) => `${b}.stall_${i}`),
  ...range(QUEUE_SPOTS).map((i) => `${b}.queue_${i}`),
]

/** Every anchor the town needs. A map missing any of them fails validation (S3 1.1 key rule). */
export const REQUIRED_ANCHORS: readonly string[] = [
  ...MARKET_BUILDINGS.flatMap(perBuilding),
  "town_gate.spawn",
  "road_1",
]

const centre = (o: TiledObject): Point => ({ x: o.x + (o.width ?? 0) / 2, y: o.y + (o.height ?? 0) / 2 })

/** Where an agent heads for a building: its entry, or the gate spawn for the town gate. */
export function anchorFor(anchors: TownAnchors, building: Building): Point {
  return building === "town_gate" ? anchors.gateSpawn : anchors.buildings[building].entry
}

/** Validates a Tiled map and pulls out the anchors. Reports every problem, never throws. */
export function parseTownMap(json: unknown): MapResult {
  const parsed = TiledMap.safeParse(json)
  if (!parsed.success)
    return { ok: false, problems: [`not a Tiled map: ${parsed.error.issues[0]?.message ?? "invalid"}`] }
  const map = parsed.data
  const problems: string[] = []

  for (const t of map.tilesets) {
    if (t.source) problems.push(`tileset ${t.source} is external: embed it in Tiled (Map → Embed Tileset)`)
    else if (!t.image) problems.push(`tileset ${t.name ?? t.firstgid} has no image: use a single-image tileset`)
  }
  for (const name of TILE_LAYERS) {
    const layer = map.layers.find((l) => l.name === name)
    if (!layer || layer.type !== "tilelayer") problems.push(`missing tile layer ${name}`)
    else if (layer.compression)
      problems.push(`layer ${name} is compressed (${layer.compression}): set Tile Layer Format to CSV`)
  }
  const anchorLayer = map.layers.find((l) => l.name === ANCHOR_LAYER && l.type === "objectgroup")
  if (!anchorLayer) return { ok: false, problems: [...problems, `missing object layer ${ANCHOR_LAYER}`] }

  const widthPx = map.width * map.tilewidth
  const heightPx = map.height * map.tileheight
  const points = new Map<string, Point>()
  for (const o of anchorLayer.objects ?? []) {
    if (points.has(o.name)) {
      problems.push(`duplicate anchor ${o.name}`)
      continue
    }
    const p = centre(o)
    if (p.x < 0 || p.y < 0 || p.x > widthPx || p.y > heightPx) problems.push(`anchor ${o.name} is outside the map`)
    points.set(o.name, p)
  }
  for (const name of REQUIRED_ANCHORS) if (!points.has(name)) problems.push(`missing anchor ${name}`)
  if (problems.length > 0) return { ok: false, problems }

  const at = (name: string) => points.get(name)!
  const buildings = Object.fromEntries(
    MARKET_BUILDINGS.map((b) => [
      b,
      {
        entry: at(`${b}.entry`),
        label: at(`${b}.label`),
        stalls: range(STALLS).map((i) => at(`${b}.stall_${i}`)),
        queue: range(QUEUE_SPOTS).map((i) => at(`${b}.queue_${i}`)),
      },
    ]),
  ) as Record<MarketBuilding, BuildingAnchors>
  const roads = [...points.entries()]
    .filter(([name]) => /^road_\d+$/.test(name))
    .sort(([a], [b]) => Number(a.slice(5)) - Number(b.slice(5)))
    .map(([, p]) => p)

  return {
    ok: true,
    value: {
      widthPx,
      heightPx,
      tileWidth: map.tilewidth,
      tileHeight: map.tileheight,
      anchors: { buildings, gateSpawn: at("town_gate.spawn"), roads },
    },
  }
}
