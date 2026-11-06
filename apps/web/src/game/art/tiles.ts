import { P } from "./palette"
import { Pix, rng, type Hex } from "./pix"

export const TILE = 16

/**
 * Tiles in fairtown-town.png, left to right; gid = index + 1. The first seven keep the stub map's
 * meaning (grass, water, road, wall, roof, decor, block) so older maps still read; the rest are variants.
 */
export const TILE_NAMES = [
  "grass",
  "water",
  "road",
  "wall",
  "roof",
  "decor",
  "block",
  "grass_tufts",
  "grass_flowers",
  "grass_roses",
  "grass_dark",
  "shore",
  "water_edge",
  "planks",
] as const
export type TileName = (typeof TILE_NAMES)[number]
export const GID = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i + 1])) as Record<TileName, number>

function speckle(p: Pix, ox: number, seed: number, base: Hex, dots: [Hex, number][]) {
  p.rect(ox, 0, TILE, TILE, base)
  const r = rng(seed)
  for (const [c, n] of dots) for (let i = 0; i < n; i++) p.px(ox + Math.floor(r() * TILE), Math.floor(r() * TILE), c)
}

function grass(p: Pix, ox: number, seed: number) {
  speckle(p, ox, seed, P.grass, [
    [P.grassLight, 10],
    [P.grassDark, 10],
  ])
}

const TUFT = ["a.a.a", ".aba.", "..b.."]
function tufts(p: Pix, ox: number, seed: number) {
  grass(p, ox, seed)
  for (const [x, y] of [
    [2, 3],
    [9, 9],
  ] as const)
    p.pattern(ox + x, y, TUFT, { a: P.grassDeep, b: P.leafLight })
}

const FLOWER = [".p.", "pcp", ".p."]
function flowers(p: Pix, ox: number, seed: number, petal: Hex) {
  grass(p, ox, seed)
  for (const [x, y] of [
    [2, 2],
    [10, 5],
    [5, 11],
  ] as const) {
    p.pattern(ox + x, y, FLOWER, { p: petal, c: P.coin })
    p.px(ox + x + 1, y + 3, P.grassDeep)
  }
}

function water(p: Pix, ox: number, seed: number) {
  speckle(p, ox, seed, P.water, [[P.waterDeep, 8]])
  for (const [x, y, w] of [
    [2, 4, 4],
    [9, 10, 5],
    [11, 2, 3],
  ] as const) {
    p.rect(ox + x, y, w, 1, P.waterLight)
    p.px(ox + x + w, y + 1, P.waterLight)
  }
}

function waterEdge(p: Pix, ox: number, seed: number) {
  water(p, ox, seed)
  for (let x = 0; x < TILE; x++) {
    const lift = (x % 6 < 3 ? 0 : 1) as number
    p.rect(ox + x, 13 - lift, 1, 3 + lift, P.foam)
  }
}

function shore(p: Pix, ox: number, seed: number) {
  speckle(p, ox, seed, P.sand, [[P.sandDark, 12]])
  p.rect(ox, 0, TILE, 2, P.sandDark)
  // Grass creeping back in along the bottom edge.
  for (let x = 0; x < TILE; x += 2) p.px(ox + x, 15, P.grassDark)
}

/** Cobbles: offset rows of rounded stones on mortar, lit from the top left. */
function road(p: Pix, ox: number) {
  p.rect(ox, 0, TILE, TILE, P.mortar)
  for (let row = 0; row < 4; row++) {
    const shift = row % 2 === 0 ? 0 : -3
    for (let col = -1; col < 3; col++) {
      const x = ox + shift + col * 6 + 1
      const y = row * 4
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 3; j++) {
          const px = x + i
          if (px < ox || px >= ox + TILE) continue
          const corner = (i === 0 || i === 4) && (j === 0 || j === 2)
          if (corner) continue
          p.px(px, y + j, j === 0 ? P.cobbleLight : j === 2 ? P.cobbleDark : P.cobble)
        }
    }
  }
}

function planks(p: Pix, ox: number) {
  p.rect(ox, 0, TILE, TILE, P.wood)
  for (let y = 0; y < TILE; y += 4) {
    p.rect(ox, y, TILE, 1, P.woodLight)
    p.rect(ox, y + 3, TILE, 1, P.woodDark)
  }
  for (const [x, y] of [
    [2, 1],
    [13, 5],
    [6, 9],
    [10, 13],
  ] as const)
    p.px(ox + x, y + 1, P.woodDark)
}

function wall(p: Pix, ox: number) {
  p.rect(ox, 0, TILE, TILE, P.stone)
  for (let y = 0; y < TILE; y += 4) {
    p.rect(ox, y + 3, TILE, 1, P.stoneDark)
    const off = (y / 4) % 2 === 0 ? 4 : 12
    p.rect(ox + off, y, 1, 3, P.stoneDark)
  }
}

function roof(p: Pix, ox: number) {
  p.rect(ox, 0, TILE, TILE, P.brick)
  for (let y = 0; y < TILE; y += 4) {
    p.rect(ox, y + 3, TILE, 1, P.brickDark)
    for (let x = (y / 4) % 2 === 0 ? 0 : 3; x < TILE; x += 6) p.px(ox + x, y + 2, P.brickDark)
  }
}

/** The whole tileset strip, TILE_NAMES.length tiles wide. */
export function paintTileset(): Pix {
  const p = new Pix(TILE * TILE_NAMES.length, TILE)
  TILE_NAMES.forEach((name, i) => {
    const ox = i * TILE
    const seed = 1000 + i
    switch (name) {
      case "grass":
        return grass(p, ox, seed)
      case "water":
        return water(p, ox, seed)
      case "road":
        return road(p, ox)
      case "wall":
        return wall(p, ox)
      case "roof":
        return roof(p, ox)
      case "decor":
        return planks(p, ox)
      case "block":
        return p.rect(ox, 0, TILE, TILE, P.magenta)
      case "grass_tufts":
        return tufts(p, ox, seed)
      case "grass_flowers":
        return flowers(p, ox, seed, P.flowerYellow)
      case "grass_roses":
        return flowers(p, ox, seed, P.flowerPink)
      case "grass_dark":
        // Same base as plain grass with denser shading, so variants never form visible squares.
        return speckle(p, ox, seed, P.grass, [
          [P.grassDark, 26],
          [P.grassLight, 6],
        ])
      case "shore":
        return shore(p, ox, seed)
      case "water_edge":
        return waterEdge(p, ox, seed)
      case "planks":
        return planks(p, ox)
    }
  })
  return p
}

/** Ground variant for a grass tile: mostly plain, some tufts and flowers, by a fixed seed. */
export function grassAt(x: number, y: number): number {
  const r = rng(x * 7919 + y * 104729)()
  if (r < 0.62) return GID.grass
  if (r < 0.8) return GID.grass_dark
  if (r < 0.92) return GID.grass_tufts
  if (r < 0.97) return GID.grass_flowers
  return GID.grass_roses
}
