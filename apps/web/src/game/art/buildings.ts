import type { MarketBuilding } from "../map/anchors"
import { P } from "./palette"
import { Pix, rng, type Hex } from "./pix"

/** A building sprite covers its 8 × 5 tile footprint plus a roof overhang above and to the sides. */
export const BUILDING_SPRITE = { w: 136, h: 96, footprintW: 128, footprintH: 80 } as const
const W = BUILDING_SPRITE.w
const H = BUILDING_SPRITE.h
const WALL = { x: 8, y: 52, w: 120, h: 40 }
const ROOF = { top: 8, bottom: 54, inset: 10 }

type Ramp = readonly [light: Hex, base: Hex, dark: Hex]
type Wall = "planks" | "stone" | "brick" | "metal" | "plaster" | "ice"
type Door = "wood" | "shutter" | "vault" | "barn" | "double"
type Extra =
  | "nets"
  | "barrels"
  | "crates"
  | "flowerboxes"
  | "awning"
  | "solar"
  | "leds"
  | "icicles"
  | "snow"
  | "hay"
  | "board"
  | "bench"

export type BuildingTheme = {
  roof: Ramp
  wall: Wall
  wallRamp: Ramp
  door: Door
  window: "glass" | "glow" | "none"
  chimney: boolean
  awning?: Ramp
  extras: readonly Extra[]
}

export const BUILDING_THEMES: Record<MarketBuilding, BuildingTheme> = {
  fish_dock: {
    roof: ["#5aa3c9", "#3f7fa6", "#2c5d7c"],
    wall: "planks",
    wallRamp: [P.woodLight, P.wood, P.woodDark],
    door: "wood",
    window: "glass",
    chimney: true,
    extras: ["nets", "barrels"],
  },
  freight_yard: {
    roof: ["#f0a560", "#d9822b", "#9c5a1a"],
    wall: "metal",
    wallRamp: ["#c9cdd2", "#a3a9b0", "#6f767e"],
    door: "shutter",
    window: "none",
    chimney: false,
    extras: ["crates"],
  },
  flower_hall: {
    roof: ["#e48ab4", "#c75b8f", "#8f3a63"],
    wall: "plaster",
    wallRamp: ["#fff6e4", "#f3e3c3", "#cdb98f"],
    door: "wood",
    window: "glass",
    chimney: false,
    awning: ["#ffffff", "#e8679b", "#a8406c"],
    extras: ["flowerboxes", "awning"],
  },
  compute_yard: {
    roof: ["#6b7a90", "#4a5568", "#2f3644"],
    wall: "metal",
    wallRamp: ["#9aa6b5", "#748194", "#4c5666"],
    door: "shutter",
    window: "glow",
    chimney: false,
    extras: ["solar", "leds"],
  },
  cold_vault: {
    roof: ["#ffffff", "#dceef7", "#a9c9da"],
    wall: "ice",
    wallRamp: ["#e6f6fc", "#bfe3f0", "#7fb4cc"],
    door: "vault",
    window: "none",
    chimney: false,
    extras: ["icicles", "snow"],
  },
  harvest_hall: {
    roof: ["#d65a49", "#b23a2f", "#7a231d"],
    wall: "planks",
    wallRamp: ["#d2574a", "#a8392f", "#6f2019"],
    door: "barn",
    window: "glass",
    chimney: false,
    extras: ["hay"],
  },
  neighbourhood_pool: {
    roof: ["#6fb36a", "#4a8a4a", "#2f5e30"],
    wall: "brick",
    wallRamp: ["#e3a37d", "#c97f57", "#93563a"],
    door: "double",
    window: "glass",
    chimney: true,
    awning: ["#fffaea", "#3a7bc8", "#245a99"],
    extras: ["board", "bench", "awning"],
  },
}

function roof(p: Pix, [light, base, dark]: Ramp) {
  const rows = ROOF.bottom - ROOF.top
  for (let j = 0; j < rows; j++) {
    const y = ROOF.top + j
    const inset = Math.round(ROOF.inset * (1 - j / rows))
    const x0 = 4 + inset
    const x1 = W - 4 - inset
    const band = j % 6
    const c = band === 0 ? light : band === 5 ? dark : base
    p.rect(x0, y, x1 - x0, 1, c)
    // Staggered shingle seams.
    if (band > 0 && band < 5) for (let x = x0 + (Math.floor(j / 6) % 2 === 0 ? 3 : 7); x < x1; x += 9) p.px(x, y, dark)
    p.px(x0, y, P.ink)
    p.px(x1 - 1, y, P.ink)
  }
  p.rect(4 + ROOF.inset, ROOF.top - 1, W - 8 - 2 * ROOF.inset, 1, P.ink)
  p.rect(4 + ROOF.inset, ROOF.top, W - 8 - 2 * ROOF.inset, 2, light)
  // Eave: a dark lip that throws a shadow on the wall.
  p.rect(2, ROOF.bottom - 2, W - 4, 2, dark)
  p.rect(2, ROOF.bottom, W - 4, 1, P.ink)
  p.rect(WALL.x, ROOF.bottom + 1, WALL.w, 2, P.ink, 90)
}

function wall(p: Pix, kind: Wall, [light, base, dark]: Ramp, seed: number) {
  const { x, y, w, h } = WALL
  p.rect(x, y, w, h, base)
  const r = rng(seed)
  switch (kind) {
    case "planks":
      for (let i = 0; i < w; i += 6) {
        p.rect(x + i, y, 1, h, dark)
        p.rect(x + i + 1, y, 1, h, light)
      }
      break
    case "metal":
      for (let i = 0; i < w; i += 4) p.rect(x + i, y, 1, h, i % 8 === 0 ? dark : light)
      break
    case "brick":
    case "stone":
    case "ice":
      for (let j = 0; j < h; j += 5) {
        p.rect(x, y + j, w, 1, dark)
        for (let i = (j / 5) % 2 === 0 ? 0 : 6; i < w; i += 12) p.rect(x + i, y + j, 1, 5, dark)
        if (kind !== "brick") for (let i = 2; i < w; i += 12) p.px(x + i + Math.floor(r() * 6), y + j + 2, light)
      }
      break
    case "plaster":
      for (let i = 0; i < 40; i++) p.px(x + Math.floor(r() * w), y + Math.floor(r() * h), dark)
      for (const bx of [x, x + w - 3]) p.rect(bx, y, 3, h, P.woodDark)
      break
  }
  p.rect(x, y + h - 3, w, 3, dark)
  p.rect(x - 1, y, 1, h, P.ink)
  p.rect(x + w, y, 1, h, P.ink)
  p.rect(x - 1, y + h, w + 2, 1, P.ink)
}

function door(p: Pix, kind: Door) {
  const cx = W / 2
  const bottom = WALL.y + WALL.h
  switch (kind) {
    case "wood":
    case "double": {
      const dw = kind === "double" ? 24 : 16
      const x = cx - dw / 2
      p.rect(x - 2, bottom - 24, dw + 4, 24, P.ink)
      p.rect(x, bottom - 22, dw, 22, P.wood)
      for (let i = x + 3; i < x + dw; i += 4) p.rect(i, bottom - 22, 1, 22, P.woodDark)
      if (kind === "double") p.rect(cx, bottom - 22, 1, 22, P.ink)
      p.px(cx + (kind === "double" ? -3 : 4), bottom - 11, P.coin)
      if (kind === "double") p.px(cx + 2, bottom - 11, P.coin)
      p.rect(x - 3, bottom - 26, dw + 6, 2, P.woodDark)
      break
    }
    case "shutter": {
      const x = cx - 22
      p.rect(x - 2, bottom - 28, 48, 28, P.ink)
      for (let j = 0; j < 26; j += 2) {
        p.rect(x, bottom - 26 + j, 44, 1, "#b8bec5")
        p.rect(x, bottom - 25 + j, 44, 1, "#8b929a")
      }
      p.rect(x + 18, bottom - 4, 8, 2, "#f2b33d")
      break
    }
    case "vault": {
      const r = 13
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const d = Math.hypot(i, j)
          if (d > r) continue
          const c: Hex = d > r - 1.5 ? P.ink : d > r - 4 ? "#8fa7b5" : d < 3 ? P.coinDark : "#c7d6de"
          p.px(cx + i, bottom - r - 2 + j, c)
        }
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k
        p.px(cx + Math.round(Math.cos(a) * 6), bottom - r - 2 + Math.round(Math.sin(a) * 6), P.ink)
      }
      break
    }
    case "barn": {
      const x = cx - 18
      p.rect(x - 2, bottom - 30, 40, 30, P.ink)
      p.rect(x, bottom - 28, 36, 28, "#8f2f27")
      p.rect(x, bottom - 28, 36, 2, P.white)
      p.rect(x, bottom - 2, 36, 2, P.white)
      p.rect(x, bottom - 28, 2, 28, P.white)
      p.rect(x + 34, bottom - 28, 2, 28, P.white)
      p.rect(cx - 1, bottom - 28, 2, 28, P.white)
      for (let i = 0; i < 26; i++) {
        p.px(x + 2 + Math.round((i * 15) / 26), bottom - 27 + i, P.white)
        p.px(x + 17 - Math.round((i * 15) / 26), bottom - 27 + i, P.white)
        p.px(cx + 1 + Math.round((i * 15) / 26), bottom - 27 + i, P.white)
        p.px(cx + 16 - Math.round((i * 15) / 26), bottom - 27 + i, P.white)
      }
      break
    }
  }
}

/** Window x positions: wide doors push the middle pair outwards. */
const windowXs = (t: BuildingTheme) => (t.door === "shutter" ? [12, 29, 93, 110] : [18, 38, 84, 104])

function windows(p: Pix, t: BuildingTheme, seed: number) {
  const kind = t.window
  if (kind === "none") return
  const r = rng(seed)
  for (const x of windowXs(t)) {
    const y = WALL.y + 9
    p.rect(x - 1, y - 1, 16, 13, P.ink)
    if (kind === "glass") {
      p.rect(x, y, 14, 11, P.glass)
      p.rect(x, y + 7, 14, 4, P.glassDark)
      p.px(x + 2, y + 2, P.white)
      p.px(x + 3, y + 2, P.white)
      p.px(x + 2, y + 3, P.white)
      p.rect(x + 6, y, 2, 11, P.ink)
      p.rect(x, y + 5, 14, 1, P.ink)
    } else {
      // Server racks behind glass, with blinking-looking LEDs.
      p.rect(x, y, 14, 11, "#16324a")
      for (let j = 1; j < 11; j += 3) {
        p.rect(x + 1, y + j, 12, 2, "#24506f")
        p.px(x + 2 + Math.floor(r() * 9), y + j, r() > 0.5 ? "#7cf29a" : "#6fe3ff")
      }
    }
    p.rect(x - 2, y + 12, 18, 2, P.woodDark)
  }
}

const BARREL = [".aaaaaa.", "abddbbba", "acccccca", "abdbbbba", "abdbbbba", "acccccca", "abdbbbba", ".aaaaaa."]

function extras(p: Pix, t: BuildingTheme, seed: number) {
  const r = rng(seed)
  const bottom = WALL.y + WALL.h
  for (const e of t.extras) {
    switch (e) {
      case "awning": {
        const [a, b, dark] = t.awning ?? ["#ffffff", "#e8679b", "#a8406c"]
        const y = WALL.y + 1
        for (let i = 0; i < WALL.w; i++) {
          const c = Math.floor(i / 6) % 2 === 0 ? a : b
          p.rect(WALL.x + i, y, 1, 5, c)
          p.px(WALL.x + i, y + 5 + (i % 6 < 3 ? 0 : 1), i % 12 < 6 ? a : b)
        }
        p.rect(WALL.x, y + 7, WALL.w, 1, dark)
        break
      }
      case "flowerboxes":
        for (const x of [17, 37, 83, 103]) {
          const y = WALL.y + 22
          p.rect(x, y, 16, 3, P.woodDark)
          for (let i = 0; i < 7; i++) {
            const c = [P.flowerPink, P.flowerYellow, P.rose, P.flowerWhite][Math.floor(r() * 4)]!
            p.px(x + 1 + i * 2, y - 1, c)
            p.px(x + 1 + i * 2, y - 2, P.leafLight)
          }
        }
        break
      case "nets":
        for (let j = 0; j < 14; j++)
          for (let i = 0; i < 14; i++)
            if ((i + j) % 4 === 0 || (i - j + 28) % 4 === 0) p.px(10 + i, WALL.y + 4 + j, "#e9d7a8")
        break
      case "barrels":
        for (const x of [WALL.x + WALL.w - 2, WALL.x + WALL.w + 4])
          p.pattern(x - 6, bottom - 10, BARREL, { a: P.ink, b: P.wood, c: P.woodDark, d: P.woodLight })
        break
      case "crates":
        for (const [x, y] of [
          [0, bottom - 12],
          [10, bottom - 12],
          [5, bottom - 22],
          [W - 12, bottom - 12],
        ] as const) {
          p.rect(x, y, 11, 11, P.ink)
          p.rect(x + 1, y + 1, 9, 9, P.woodLight)
          p.rect(x + 1, y + 5, 9, 1, P.woodDark)
          p.rect(x + 5, y + 1, 1, 9, P.woodDark)
        }
        break
      case "solar":
        for (let k = 0; k < 4; k++) {
          const x = 24 + k * 24
          p.rect(x - 1, 22, 20, 14, P.ink)
          p.rect(x, 23, 18, 12, "#2b4d8f")
          for (let i = 0; i < 18; i += 6) p.rect(x + i, 23, 1, 12, "#4d76c4")
          p.rect(x, 29, 18, 1, "#4d76c4")
          p.px(x + 2, 24, "#cfe2ff")
        }
        break
      case "leds":
        for (let i = 0; i < 10; i++) p.px(WALL.x + 4 + i * 12, WALL.y + 30, i % 3 === 0 ? "#7cf29a" : "#6fe3ff")
        break
      case "icicles":
        for (let x = 4; x < W - 4; x += 5) {
          const len = 2 + Math.floor(r() * 4)
          p.rect(x, ROOF.bottom + 1, 1, len, "#e6f6fc")
          p.px(x, ROOF.bottom + 1 + len, "#9fd3ee")
        }
        break
      case "snow":
        for (let x = 4 + ROOF.inset; x < W - 4 - ROOF.inset; x++)
          p.rect(x, ROOF.top - 2, 1, 2 + (x % 7 === 0 ? 1 : 0), P.white)
        break
      case "hay":
        for (const x of [0, W - 16]) {
          p.rect(x, bottom - 12, 16, 12, P.ink)
          p.rect(x + 1, bottom - 11, 14, 10, "#e8c35a")
          for (let i = 0; i < 6; i++) p.px(x + 2 + Math.floor(r() * 12), bottom - 10 + Math.floor(r() * 8), "#b8902f")
          p.rect(x + 1, bottom - 7, 14, 1, "#b8902f")
        }
        break
      case "board":
        p.rect(14, WALL.y + 22, 22, 15, P.ink)
        p.rect(15, WALL.y + 23, 20, 13, P.wood)
        // Notices pinned to the board.
        for (const [x, dy, c] of [
          [17, 1, P.white],
          [24, 2, P.flowerYellow],
          [18, 7, P.flowerBlue],
          [27, 6, P.white],
        ] as const)
          p.rect(x, WALL.y + 23 + dy, 5, 4, c)
        break
      case "bench":
        p.rect(W - 34, bottom - 6, 22, 2, P.woodDark)
        p.rect(W - 34, bottom - 9, 22, 2, P.wood)
        p.rect(W - 32, bottom - 4, 2, 4, P.ink)
        p.rect(W - 16, bottom - 4, 2, 4, P.ink)
        break
    }
  }
}

function chimney(p: Pix, t: BuildingTheme) {
  if (!t.chimney) return
  const x = W - 34
  p.rect(x - 1, ROOF.top + 1, 12, 16, P.ink)
  p.rect(x, ROOF.top + 2, 10, 14, P.brick)
  p.rect(x, ROOF.top + 2, 10, 2, P.brickDark)
  p.rect(x + 4, ROOF.top + 6, 1, 10, P.brickDark)
}

/** Where chimney smoke rises, relative to the sprite's top-left; null when the building has none. */
export function chimneyAt(b: MarketBuilding): { x: number; y: number } | null {
  return BUILDING_THEMES[b].chimney ? { x: W - 29, y: ROOF.top } : null
}

/** Window centres relative to the sprite's top-left, for night glow. */
export function windowsAt(b: MarketBuilding): { x: number; y: number }[] {
  const t = BUILDING_THEMES[b]
  if (t.window === "none") return []
  return windowXs(t).map((x) => ({ x: x + 7, y: WALL.y + 14 }))
}

export function paintBuilding(b: MarketBuilding): Pix {
  const t = BUILDING_THEMES[b]
  const p = new Pix(W, H)
  const seed = [...b].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7)
  // Ground shadow to the lower right.
  p.rect(WALL.x + 6, WALL.y + WALL.h + 1, WALL.w, 3, P.ink, 70)
  p.rect(WALL.x + WALL.w + 1, WALL.y + 6, 4, WALL.h - 2, P.ink, 70)
  wall(p, t.wall, t.wallRamp, seed)
  roof(p, t.roof)
  chimney(p, t)
  windows(p, t, seed)
  door(p, t.door)
  extras(p, t, seed)
  return p
}
