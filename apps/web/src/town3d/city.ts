import * as THREE from "three"
import { rng } from "../game/art/pix"
import type { WalkGrid } from "../game/agents/pathing"
import { MARKET_BUILDINGS, type MarketBuilding, type TownMap } from "../game/map/anchors"
import { footprintOf, reservedTiles, type Prop } from "../game/map/scenery"
import type { TiledMap } from "../game/map/tiled"
import { TILE_PX } from "./coords"
import { WINDOW_LEVELS, type Look, type Models } from "./models"

/** Palette of the night town: slate ground, graphite asphalt, ink-blue water, cyan routes. */
export const CITY = {
  ground: 0x1a2232,
  asphalt: 0x1b212d,
  kerb: 0x2a3142,
  water: 0x0c2342,
  route: 0x3fd8ff,
  lamp: 0xffc27a,
} as const

const C = "city-commercial/"
const I = "city-industrial/"
const S = "city-suburban/"
const W = "watercraft/"
const N = "nature/"
const CARS = ["car/sedan", "car/suv", "car/taxi", "car/van", "car/hatchback-sports"] as const
const HOMES = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => `${S}building-type-${k}`)
const OUTSKIRTS = ["a", "b", "c", "d"].map((k) => `${C}low-detail-building-${k}`)
const TREES = [`${N}tree_default`, `${N}tree_oak`, `${N}tree_detailed`] as const
const PINES = [`${N}tree_pineRoundB`, `${N}tree_pineTallA`, `${N}tree_pineSmallA`] as const
const BUSHES = [`${N}plant_bushLarge`, `${N}plant_bush`] as const

type Piece = {
  key: string
  look: Look
  at: [number, number]
  space: { w?: number; d?: number; h?: number }
  turn?: number
  /** Window light for this piece; otherwise one of the town's levels. */
  lit?: number
}

/** What each market is built from, in the footprint's own units (0..1 across, 0..1 deep). */
const MARKETS: Record<MarketBuilding, Piece[]> = {
  fish_dock: [
    { key: `${I}building-c`, look: "clay", at: [0.35, 0.5], space: { w: 0.62, d: 1 } },
    { key: `${W}cargo-container-a`, look: "keep", at: [0.8, 0.35], space: { w: 0.22 }, turn: Math.PI / 2 },
    { key: `${W}cargo-container-b`, look: "keep", at: [0.8, 0.75], space: { w: 0.22 }, turn: Math.PI / 2 },
  ],
  freight_yard: [
    { key: `${I}building-f`, look: "clay", at: [0.3, 0.5], space: { w: 0.55, d: 1 } },
    { key: `${W}cargo-pile-a`, look: "keep", at: [0.75, 0.3], space: { w: 0.32 } },
    { key: `${W}cargo-pile-b`, look: "keep", at: [0.75, 0.78], space: { w: 0.3 } },
  ],
  flower_hall: [
    { key: `${C}building-b`, look: "clay", at: [0.5, 0.45], space: { w: 0.7, d: 0.9 } },
    { key: `${C}detail-awning-wide`, look: "keep", at: [0.5, 0.98], space: { w: 0.6 } },
  ],
  compute_yard: [
    { key: `${C}building-skyscraper-b`, look: "clay", at: [0.3, 0.5], space: { w: 0.42, d: 1 }, lit: 0.35 },
    { key: `${C}building-skyscraper-c`, look: "clay", at: [0.72, 0.5], space: { w: 0.42, d: 1 }, lit: 0.6 },
  ],
  harvest_hall: [
    { key: `${I}building-a`, look: "clay", at: [0.38, 0.5], space: { w: 0.66, d: 1 } },
    { key: `${I}detail-tank`, look: "clay", at: [0.86, 0.45], space: { w: 0.22 } },
  ],
  neighbourhood_pool: [{ key: `${C}building-e`, look: "clay", at: [0.4, 0.5], space: { w: 0.6, d: 1 } }],
  cold_vault: [
    { key: `${I}building-h`, look: "clay", at: [0.4, 0.5], space: { w: 0.7, d: 1 } },
    { key: `${I}chimney-large`, look: "clay", at: [0.88, 0.35], space: { w: 0.16 } },
  ],
}

/** Every model the city needs, for loading up front. */
export const CITY_MODELS: string[] = [
  ...new Set([
    ...Object.values(MARKETS).flatMap((ps) => ps.map((p) => p.key)),
    ...CARS,
    ...HOMES,
    ...OUTSKIRTS,
    ...TREES,
    ...PINES,
    ...BUSHES,
    `${W}boat-fishing-small`,
    "car/truck-flat",
  ]),
]

export type City = {
  group: THREE.Group
  /** World position (x, z) of the settlement hub on the ground: every payment passes through it. */
  core: { x: number; z: number }
  /** Invisible boxes over each market, for clicks. */
  hits: { building: MarketBuilding; mesh: THREE.Mesh }[]
  /** Where each market's roof is, for its sign and weather. */
  roofs: Record<MarketBuilding, THREE.Vector3>
  tick(t: number, still: boolean): void
}

/** Runs of road tiles along rows and columns, for the cyan route lines. */
export function roadRuns(roads: WalkGrid): { x0: number; z0: number; x1: number; z1: number }[] {
  const runs: { x0: number; z0: number; x1: number; z1: number }[] = []
  const isRoad = (x: number, y: number) => roads.cells[y]?.[x] === 0
  for (let y = 0; y < roads.height; y++) {
    let start = -1
    for (let x = 0; x <= roads.width; x++) {
      const on = x < roads.width && isRoad(x, y) && (isRoad(x - 1, y) || isRoad(x + 1, y))
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        if (x - start >= 2) runs.push({ x0: start + 0.5, z0: y + 0.5, x1: x - 0.5, z1: y + 0.5 })
        start = -1
      }
    }
  }
  for (let x = 0; x < roads.width; x++) {
    let start = -1
    for (let y = 0; y <= roads.height; y++) {
      const on = y < roads.height && isRoad(x, y) && (isRoad(x, y - 1) || isRoad(x, y + 1))
      if (on && start < 0) start = y
      if (!on && start >= 0) {
        if (y - start >= 2) runs.push({ x0: x + 0.5, z0: start + 0.5, x1: x + 0.5, z1: y - 0.5 })
        start = -1
      }
    }
  }
  return runs
}

/** Road tiles where routes meet or end: junctions and dead ends glow as nodes. */
export function routeNodes(roads: WalkGrid): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  const isRoad = (x: number, y: number) => roads.cells[y]?.[x] === 0
  for (let y = 0; y < roads.height; y++)
    for (let x = 0; x < roads.width; x++) {
      if (!isRoad(x, y)) continue
      const n = [isRoad(x - 1, y), isRoad(x + 1, y), isRoad(x, y - 1), isRoad(x, y + 1)].filter(Boolean).length
      if (n !== 2) out.push({ x: x + 0.5, z: y + 0.5 })
    }
  return out
}

/**
 * Homes on free ground: 3 × 3 tile lots that touch no road, water, building, stall, queue or prop,
 * within a short walk of a road. Fixed by the seed, so the town is the same every time.
 */
export function homeLots(
  town: TownMap,
  walk: WalkGrid,
  roads: WalkGrid,
  props: readonly Prop[],
  seed = 11,
): { x: number; z: number; facing: number }[] {
  const reserved = reservedTiles(town, walk, roads)
  for (const p of props) reserved.add(`${p.tx},${p.ty}`)
  const r = rng(seed)
  const lots: { x: number; z: number; facing: number }[] = []
  const nearestRoad = (cx: number, cy: number) => {
    let best: { d: number; dx: number; dy: number } | null = null
    for (let y = 0; y < roads.height; y++)
      for (let x = 0; x < roads.width; x++)
        if (roads.cells[y]![x] === 0) {
          const d = Math.abs(x - cx) + Math.abs(y - cy)
          if (!best || d < best.d) best = { d, dx: x - cx, dy: y - cy }
        }
    return best
  }
  for (let ty = 1; ty + 3 <= walk.height - 1; ty += 4)
    for (let tx = 1; tx + 3 <= walk.width - 1; tx += 4) {
      let clear = true
      for (let y = ty; y < ty + 3 && clear; y++)
        for (let x = tx; x < tx + 3 && clear; x++) if (reserved.has(`${x},${y}`)) clear = false
      if (!clear) continue
      const road = nearestRoad(tx + 1, ty + 1)
      if (!road || road.d > 12 || r() < 0.08) continue
      // Face the road: the front door looks towards it.
      const facing =
        Math.abs(road.dx) > Math.abs(road.dy) ? (road.dx > 0 ? Math.PI / 2 : -Math.PI / 2) : road.dy > 0 ? 0 : Math.PI
      lots.push({ x: tx + 1.5, z: ty + 1.5, facing })
    }
  return lots
}

/** Many copies of one model as instanced meshes, one per part. */
function instanced(models: Models, key: string, look: Look, transforms: THREE.Matrix4[], lit = 1): THREE.Object3D[] {
  if (transforms.length === 0) return []
  return models.parts(key, look, lit).map(({ geometry, material }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.needsUpdate = true
    return mesh
  })
}

const placeAt = (x: number, z: number, scale: number, turn = 0, y = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
    new THREE.Vector3(scale, scale, scale),
  )

/** Speckled slate ground: never flat, never busy. */
function groundTexture(): THREE.Texture {
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const g = c.getContext("2d")
  if (g) {
    g.fillStyle = "#1a2232"
    g.fillRect(0, 0, 256, 256)
    const r = rng(3)
    for (let i = 0; i < 2600; i++) {
      const v = 22 + Math.floor(r() * 18)
      g.fillStyle = `rgba(${v}, ${v + 8}, ${v + 22}, ${0.35 + r() * 0.4})`
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2)
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function layerTiles(map: TiledMap, name: string): number[] {
  const l = map.layers.find((x) => x.name === name) as { data?: number[] } | undefined
  return Array.isArray(l?.data) ? l.data : []
}

/** A wind turbine: a tall pole, a nacelle and three blades that turn, with a blinking red light. */
function turbine(): { group: THREE.Group; tick: (t: number, still: boolean) => void } {
  const group = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: 0xc9d2e3, roughness: 0.5 })
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 7, 10), white)
  pole.position.y = 3.5
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.7), white)
  head.position.set(0, 7.05, 0)
  const rotor = new THREE.Group()
  rotor.position.set(0, 7.05, 0.4)
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.04), white)
    blade.position.y = 1.3
    const arm = new THREE.Group()
    arm.rotation.z = (i * Math.PI * 2) / 3
    arm.add(blade)
    rotor.add(arm)
  }
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 3 }),
  )
  beacon.position.set(0, 7.25, 0)
  group.add(pole, head, rotor, beacon)
  pole.castShadow = true
  return {
    group,
    tick(t, still) {
      if (still) return
      rotor.rotation.z = t / 900
      beacon.visible = Math.floor(t / 900) % 2 === 0
    },
  }
}

/**
 * The night town (D-43): Kenney's CC0 models in graphite clay with lit windows, on slate ground
 * with asphalt roads and cyan route lines, homes and trees on the free ground, outskirts fading
 * into the fog, turbines turning, and the settlement hub glowing at the central crossing.
 */
export function buildCity(
  models: Models,
  town: TownMap,
  raw: TiledMap,
  walk: WalkGrid,
  roads: WalkGrid,
  props: Prop[],
): City {
  const group = new THREE.Group()
  const w = town.widthPx / TILE_PX
  const d = town.heightPx / TILE_PX
  const r = rng(29)
  const ticks: ((t: number, still: boolean) => void)[] = []

  // Ground, running out past the map into the fog.
  const tex = groundTexture()
  tex.repeat.set((w + 80) / 6, (d + 80) / 6)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 80, d + 80),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.97 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(w / 2, 0, d / 2)
  ground.receiveShadow = true
  group.add(ground)

  // Water: dark, glossy, catching the night sky.
  const water = layerTiles(raw, "water")
  const waterTiles: THREE.Matrix4[] = []
  water.forEach((gid, i) => {
    if (gid)
      waterTiles.push(
        new THREE.Matrix4().makeTranslation((i % raw.width) + 0.5, 0.012, Math.floor(i / raw.width) + 0.5),
      )
  })
  if (waterTiles.length) {
    const sea = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.001, 1.001).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: CITY.water,
        roughness: 0.05,
        metalness: 0.6,
        envMapIntensity: 1.6,
        userData: { reflective: true },
      }),
      waterTiles.length,
    )
    waterTiles.forEach((m, i) => sea.setMatrixAt(i, m))
    sea.receiveShadow = true
    group.add(sea)
  }

  // Asphalt on every road tile, a kerb round it, and cyan route lines down the middle.
  const roadTiles: THREE.Matrix4[] = []
  for (let y = 0; y < roads.height; y++)
    for (let x = 0; x < roads.width; x++)
      if (roads.cells[y]![x] === 0) roadTiles.push(new THREE.Matrix4().makeTranslation(x + 0.5, 0.02, y + 0.5))
  if (roadTiles.length) {
    const asphalt = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.002, 0.04, 1.002),
      new THREE.MeshStandardMaterial({ color: CITY.asphalt, roughness: 0.92 }),
      roadTiles.length,
    )
    roadTiles.forEach((m, i) => asphalt.setMatrixAt(i, m))
    asphalt.receiveShadow = true
    group.add(asphalt)
  }
  const routeMat = new THREE.MeshStandardMaterial({ color: CITY.route, emissive: CITY.route, emissiveIntensity: 1.3 })
  for (const run of roadRuns(roads)) {
    const len = Math.hypot(run.x1 - run.x0, run.z1 - run.z0)
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(run.x1 !== run.x0 ? len : 0.07, 0.02, run.z1 !== run.z0 ? len : 0.07),
      routeMat,
    )
    line.position.set((run.x0 + run.x1) / 2, 0.05, (run.z0 + run.z1) / 2)
    group.add(line)
  }
  const nodeMat = new THREE.MeshStandardMaterial({ color: CITY.route, emissive: CITY.route, emissiveIntensity: 1.4 })
  const nodes = routeNodes(roads).map((n) => {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 20), nodeMat)
    dot.position.set(n.x, 0.06, n.z)
    group.add(dot)
    return dot
  })
  ticks.push((t, still) => {
    const k = still ? 1 : 1 + Math.sin(t / 700) * 0.18
    for (const n of nodes) n.scale.set(k, 1, k)
  })

  // The seven markets, built from Kenney's kits and dressed in clay; each with a hit box and a roof point.
  const hits: City["hits"] = []
  const roofs = {} as Record<MarketBuilding, THREE.Vector3>
  for (const b of MARKET_BUILDINGS) {
    const f = footprintOf(town, b)
    const fx = f.x / TILE_PX
    const fz = f.y / TILE_PX
    const fw = f.w / TILE_PX
    const fd = f.h / TILE_PX
    let top = 0
    MARKETS[b].forEach((p, i) => {
      const lit = p.lit ?? (p.look === "clay" ? WINDOW_LEVELS[1 + ((i + b.length) % 3)]! : 1)
      const o = models.make(
        p.key,
        p.look,
        { w: p.space.w && p.space.w * fw, d: p.space.d && p.space.d * fd, h: p.space.h },
        lit,
      )
      o.position.set(fx + p.at[0] * fw, 0, fz + p.at[1] * fd)
      o.rotation.y = p.turn ?? 0
      group.add(o)
      top = Math.max(top, new THREE.Box3().setFromObject(o).max.y)
    })
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(fw, Math.max(1, top), fd),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    hit.position.set(fx + fw / 2, Math.max(1, top) / 2, fz + fd / 2)
    group.add(hit)
    hits.push({ building: b, mesh: hit })
    roofs[b] = new THREE.Vector3(fx + fw / 2, top + 0.4, fz + fd / 2)
  }

  // A fishing boat moored off the dock, if that is water.
  const dock = footprintOf(town, "fish_dock")
  const moorX = Math.floor((dock.x + dock.w + 24) / TILE_PX)
  const moorZ = Math.floor((dock.y - 20) / TILE_PX)
  if (water[moorZ * raw.width + moorX]) {
    const boat = models.make(`${W}boat-fishing-small`, "keep", { w: 2.6 })
    boat.position.set(moorX + 0.5, 0, moorZ + 0.3)
    boat.rotation.y = Math.PI / 2
    group.add(boat)
    const y0 = boat.position.y
    ticks.push((t, still) => {
      boat.position.y = still ? y0 : y0 + Math.sin(t / 900) * 0.04
      boat.rotation.z = still ? 0 : Math.sin(t / 1300) * 0.03
    })
  }

  // Trees, pines and bushes, instanced by kind; lamp posts with warm heads.
  const byKey = new Map<string, THREE.Matrix4[]>()
  const add = (key: string, m: THREE.Matrix4) => byKey.set(key, [...(byKey.get(key) ?? []), m])
  const lampHeads: THREE.Matrix4[] = []
  for (const p of props) {
    const x = p.x / TILE_PX
    const z = (p.y - 8) / TILE_PX
    if (p.kind === "lamp") {
      lampHeads.push(new THREE.Matrix4().makeTranslation(x, 0, z))
      continue
    }
    const set = p.kind === "tree" ? TREES : p.kind === "pine" ? PINES : BUSHES
    const key = set[p.variant % set.length]!
    const size = p.kind === "bush" ? 0.8 : p.kind === "pine" ? 1.5 : 1.8
    add(key, placeAt(x, z, models.scaleFor(key, { h: size * (0.85 + r() * 0.35) }), r() * Math.PI * 2))
  }
  for (const [key, ms] of byKey) for (const o of instanced(models, key, "foliage", ms)) group.add(o)
  if (lampHeads.length) {
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.05, 1.4, 6).translate(0, 0.7, 0),
      new THREE.MeshStandardMaterial({ color: 0x2b3245, roughness: 0.6, metalness: 0.4 }),
      lampHeads.length,
    )
    const bulb = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.11, 10, 8).translate(0, 1.45, 0),
      new THREE.MeshStandardMaterial({ color: CITY.lamp, emissive: CITY.lamp, emissiveIntensity: 4 }),
      lampHeads.length,
    )
    const pool = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2).translate(0, 0.035, 0),
      new THREE.MeshBasicMaterial({
        color: CITY.lamp,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      lampHeads.length,
    )
    lampHeads.forEach((m, i) => {
      pole.setMatrixAt(i, m)
      bulb.setMatrixAt(i, m)
      pool.setMatrixAt(i, m)
    })
    pole.castShadow = true
    group.add(pole, bulb, pool)
  }

  // Homes on free lots, facing the road, some windows lit.
  const homes = new Map<string, THREE.Matrix4[]>()
  for (const lot of homeLots(town, walk, roads, props)) {
    const key = HOMES[Math.floor(r() * HOMES.length)]!
    const level = Math.floor(r() * 3)
    const k = `${key}|${level}`
    homes.set(k, [...(homes.get(k) ?? []), placeAt(lot.x, lot.z, models.scaleFor(key, { w: 2.4, d: 2.4 }), lot.facing)])
  }
  for (const [k, ms] of homes) {
    const [key, level] = k.split("|")
    for (const o of instanced(models, key!, "clay", ms, WINDOW_LEVELS[Number(level)]!)) group.add(o)
  }

  // Outskirts past the far and side edges (never the near one): rooftops close by, a few towers
  // further back, all fading into the fog.
  const outskirts = new Map<string, THREE.Matrix4[]>()
  const putOut = (x: number, z: number, near: boolean) => {
    const pool = near ? HOMES : OUTSKIRTS
    const key = pool[Math.floor(r() * pool.length)]!
    const level = Math.floor(r() * 3)
    const k = `${key}|${level}`
    const scale = near ? models.scaleFor(key, { w: 2.3 + r() * 0.6 }) : models.scaleFor(key, { w: 2.6 + r() * 1.4 })
    outskirts.set(k, [...(outskirts.get(k) ?? []), placeAt(x, z, scale, Math.floor(r() * 4) * (Math.PI / 2))])
  }
  for (let gz = -18; gz < d - 2; gz += 3.4)
    for (let gx = -20; gx < w + 20; gx += 3.4) {
      const inside = gx > -3 && gx < w + 1 && gz > -3
      const edge = Math.max(-gx, gx - w, -gz) // how far past the map
      if (inside || r() < (edge < 9 ? 0.3 : 0.6)) continue
      putOut(gx + r(), gz + r(), edge < 9)
    }
  for (const [k, ms] of outskirts) {
    const [key, level] = k.split("|")
    for (const o of instanced(models, key!, "clay", ms, WINDOW_LEVELS[Number(level)]!)) group.add(o)
  }

  // Turbines on the far side, turning slowly.
  for (const [x, z] of [
    [w + 9, d * 0.25],
    [w + 13, d * 0.55],
    [-7, d * 0.7],
  ] as const) {
    const tb = turbine()
    tb.group.position.set(x, 0, z)
    tb.group.rotation.y = -0.6
    group.add(tb.group)
    ticks.push(tb.tick)
  }

  // Parked cars on a few kerbs.
  const kerbs = roadTiles.filter((_, i) => i % 9 === 4).slice(0, 8)
  kerbs.forEach((m, i) => {
    const p = new THREE.Vector3().setFromMatrixPosition(m)
    const key = CARS[i % CARS.length]!
    const car = models.make(key, "keep", { w: 0.55 })
    const vertical = roads.cells[Math.floor(p.z) - 1]?.[Math.floor(p.x)] === 0
    car.position.set(p.x + (vertical ? 0.62 : 0), 0, p.z + (vertical ? 0 : 0.62))
    car.rotation.y = vertical ? 0 : Math.PI / 2
    group.add(car)
  })

  // The settlement hub over the crossing nearest the middle: an orb, a light column and a halo of dots.
  const crossings = routeNodes(roads)
  const centre = crossings.reduce(
    (best, n) => (Math.hypot(n.x - w / 2, n.z - d / 2) < Math.hypot(best.x - w / 2, best.z - d / 2) ? n : best),
    crossings[0] ?? { x: w / 2, z: d / 2 },
  )
  const core = { x: centre.x, z: centre.z }
  // The hub glows, but softly: it marks the crossing without washing out the streets around it.
  const cyan = new THREE.MeshStandardMaterial({ color: CITY.route, emissive: CITY.route, emissiveIntensity: 1.5 })
  const dotMat = new THREE.MeshStandardMaterial({ color: CITY.route, emissive: CITY.route, emissiveIntensity: 0.9 })
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), cyan)
  orb.position.set(core.x, 2.4, core.z)
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8),
    new THREE.MeshBasicMaterial({
      color: CITY.route,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  column.position.set(core.x, 1.2, core.z)
  const dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8), dotMat, 60)
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2
    const rad = 0.9 + Math.sqrt(r()) * 2.2
    dots.setMatrixAt(
      i,
      new THREE.Matrix4().makeTranslation(core.x + Math.cos(a) * rad, 0.07, core.z + Math.sin(a) * rad),
    )
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.025, 8, 48), cyan)
  ring.position.copy(orb.position)
  ring.rotation.x = Math.PI / 2
  group.add(orb, column, dots, ring)
  ticks.push((t, still) => {
    if (still) return
    ring.rotation.z = t / 1600
    orb.position.y = 2.4 + Math.sin(t / 900) * 0.08
    cyan.emissiveIntensity = 1.4 + Math.sin(t / 650) * 0.25
  })

  return {
    group,
    core,
    hits,
    roofs,
    tick(t, still) {
      for (const fn of ticks) fn(t, still)
    },
  }
}
