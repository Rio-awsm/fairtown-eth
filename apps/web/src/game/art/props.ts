import { P } from "./palette"
import { Pix, rng, type Hex } from "./pix"

/** Small sprites: scenery, stalls, goods, vehicles and effect particles. All painted here. */

function disc(p: Pix, cx: number, cy: number, r: number, c: Hex) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) p.px(cx + x, cy + y, c)
}

export function paintTree(seed: number): Pix {
  const p = new Pix(28, 34)
  const r = rng(seed)
  p.rect(7, 30, 16, 3, P.ink, 60)
  p.rect(12, 20, 5, 11, P.trunk)
  p.rect(12, 20, 1, 11, P.woodDark)
  disc(p, 14, 13, 11, P.leafDark)
  disc(p, 13, 11, 10, P.leaf)
  disc(p, 11, 9, 6, P.leafLight)
  for (let i = 0; i < 14; i++)
    p.px(5 + Math.floor(r() * 18), 4 + Math.floor(r() * 16), r() > 0.5 ? P.leafDark : P.leafLight)
  // Fruit on some trees.
  if (seed % 3 === 0)
    for (const [x, y] of [
      [9, 14],
      [17, 10],
      [19, 17],
    ] as const)
      p.px(x, y, P.rose)
  return p.outline(P.ink)
}

export function paintPine(): Pix {
  const p = new Pix(22, 34)
  p.rect(5, 30, 12, 3, P.ink, 60)
  p.rect(9, 25, 4, 6, P.trunk)
  for (let tier = 0; tier < 3; tier++) {
    const top = 2 + tier * 7
    for (let j = 0; j < 10; j++) {
      const half = Math.min(9, 2 + Math.floor(j * (0.6 + tier * 0.12)))
      p.rect(11 - half, top + j, half * 2, 1, j % 3 === 0 ? P.leafLight : P.leaf)
      p.px(11 + half - 1, top + j, P.leafDark)
    }
  }
  return p.outline(P.ink)
}

export function paintBush(): Pix {
  const p = new Pix(16, 12)
  p.rect(2, 9, 12, 2, P.ink, 60)
  disc(p, 5, 6, 4, P.leaf)
  disc(p, 10, 6, 4, P.leaf)
  disc(p, 7, 4, 3, P.leafLight)
  p.px(4, 4, P.flowerPink)
  p.px(11, 5, P.flowerPink)
  return p.outline(P.ink)
}

export function paintLamp(): Pix {
  const p = new Pix(8, 26)
  p.rect(1, 23, 6, 2, P.ink, 60)
  p.rect(3, 6, 2, 18, "#3b3350")
  p.rect(2, 22, 4, 2, "#3b3350")
  p.rect(1, 1, 6, 6, "#3b3350")
  p.rect(2, 2, 4, 4, P.lampGlow)
  p.px(2, 2, P.white)
  return p.outline(P.ink)
}

export function paintFence(): Pix {
  const p = new Pix(16, 10)
  for (const x of [1, 13]) p.rect(x, 0, 2, 10, P.wood)
  p.rect(0, 3, 16, 2, P.woodLight)
  p.rect(0, 7, 16, 1, P.woodDark)
  return p.outline(P.ink)
}

export function paintBoat(): Pix {
  const p = new Pix(36, 22)
  // Mast and sail.
  p.rect(17, 0, 1, 14, P.woodDark)
  for (let j = 0; j < 11; j++) p.rect(18, 1 + j, Math.min(10, 1 + j), 1, j % 4 === 0 ? P.parchmentDeep : P.white)
  // Hull.
  for (let j = 0; j < 6; j++) p.rect(2 + j, 14 + j, 32 - j * 2, 1, j < 2 ? P.brick : P.wood)
  p.rect(4, 14, 28, 1, P.white)
  return p.outline(P.ink)
}

export function paintGate(): Pix {
  const p = new Pix(84, 44)
  for (const x of [0, 70]) {
    p.rect(x, 8, 14, 36, P.stone)
    for (let j = 12; j < 44; j += 6) p.rect(x, j, 14, 1, P.stoneDark)
    p.rect(x, 8, 14, 2, P.stoneLight)
    p.rect(x + 3, 2, 8, 6, P.stone)
    p.rect(x + 4, 0, 6, 2, P.brick)
  }
  p.rect(10, 10, 64, 6, P.wood)
  p.rect(10, 10, 64, 1, P.woodLight)
  p.rect(10, 15, 64, 1, P.woodDark)
  // Bunting under the beam.
  const flags: Hex[] = [P.brick, P.coin, "#3a7bc8", "#4f9a4a"]
  for (let i = 0; i < 9; i++) {
    const x = 14 + i * 7
    const c = flags[i % flags.length]!
    p.rect(x, 17, 5, 2, c)
    p.rect(x + 1, 19, 3, 1, c)
    p.px(x + 2, 20, c)
  }
  return p.outline(P.ink)
}

/** A market stall: the awning is white so a status tint can colour it; the counter is a separate sprite. */
export function paintAwning(): Pix {
  const p = new Pix(22, 9)
  for (let x = 0; x < 22; x++) {
    const c: Hex = Math.floor(x / 4) % 2 === 0 ? "#ffffff" : "#c9c9c9"
    p.rect(x, 0, 1, 6, c)
    p.px(x, 6 + (x % 4 < 2 ? 0 : 1), c)
  }
  return p.outline(P.ink)
}

export function paintCounter(): Pix {
  const p = new Pix(20, 12)
  p.rect(2, 0, 2, 4, P.woodDark)
  p.rect(16, 0, 2, 4, P.woodDark)
  p.rect(0, 4, 20, 3, P.woodLight)
  p.rect(0, 7, 20, 4, P.wood)
  p.rect(0, 10, 20, 1, P.woodDark)
  return p.outline(P.ink)
}

type Icon = { rows: readonly string[]; key: Record<string, Hex> }
/** 8 × 8 goods icons on the stall counter. */
export const GOODS: Record<string, Icon> = {
  fish: {
    rows: ["........", "..aaa..a", ".abbbaab", "abebbbab", ".abbbaab", "..aaa..a", "........", "........"],
    key: { a: "#2c5d7c", b: "#7fb8d8", e: P.ink },
  },
  tomato: {
    rows: ["...gg...", "..gaag..", ".aaaaaa.", "aabaaaaa", "aaaaaaaa", ".aaaaaa.", "..aaaa..", "........"],
    key: { a: "#d63c2f", b: "#ff8a7a", g: "#3e8a3f" },
  },
  onion: {
    rows: ["...g....", "...g....", "..aaa...", ".abaaa..", ".aaaaa..", ".aaaaa..", "..aaa...", "...c...."],
    key: { a: "#a76bc9", b: "#e2c2f2", g: "#3e8a3f", c: "#e9d39a" },
  },
  marigold: {
    rows: ["..a.a...", ".aabaa..", "aabcbaa.", ".abcba..", "aabbbaa.", ".a.a.a..", "...g....", "...g...."],
    key: { a: "#f59e0b", b: "#fbbf24", c: "#b45309", g: "#3e8a3f" },
  },
  rose: {
    rows: ["..aaa...", ".abaaa..", ".aabba..", "..aaa...", "...g....", "..gg....", "...g....", "...g...."],
    key: { a: P.rose, b: "#ff9aaa", g: "#3e8a3f" },
  },
  truck: {
    rows: ["........", "aaaaa...", "abbbaccc", "abbbacdc", "aaaaaccc", ".e...e..", "........", "........"],
    key: { a: "#e07a2a", b: "#f2b33d", c: "#e07a2a", d: P.glass, e: P.ink },
  },
  crate: {
    rows: ["aaaaaaa.", "abcbcba.", "acbbbca.", "abbbbba.", "acbbbca.", "abcbcba.", "aaaaaaa.", "........"],
    key: { a: P.woodDark, b: P.woodLight, c: P.wood },
  },
  snow: {
    rows: ["...a....", ".a.a.a..", "..aaa...", "aaabaaa.", "..aaa...", ".a.a.a..", "...a....", "........"],
    key: { a: "#7fc8e8", b: P.white },
  },
  chip: {
    rows: [".a.a.a..", "bbbbbbb.", "abcccba.", "bcdddcb.", "abcccba.", "bbbbbbb.", ".a.a.a..", "........"],
    key: { a: "#c9cdd2", b: "#3b3350", c: "#4a5568", d: "#7cf29a" },
  },
  unknown: {
    rows: ["..aaa...", ".a...a..", ".....a..", "...aa...", "...a....", "........", "...a....", "........"],
    key: { a: P.inkSoft },
  },
}

export const GOOD_OF: Record<string, keyof typeof GOODS> = {
  cod: "fish",
  haddock: "fish",
  tomato: "tomato",
  onion: "onion",
  marigold: "marigold",
  rose: "rose",
  truck_capacity: "truck",
  cargo_slot: "crate",
  storage_slot: "snow",
  gpu_hour: "chip",
}

export function paintGood(name: keyof typeof GOODS): Pix {
  const icon = GOODS[name]!
  return new Pix(8, 8).pattern(0, 0, icon.rows, icon.key)
}

/** Delivery truck, side view facing right; flip for left. */
export function paintTruck(): Pix {
  const p = new Pix(30, 18)
  p.rect(3, 15, 26, 2, P.ink, 60)
  p.rect(1, 2, 18, 11, P.parchment)
  p.rect(1, 2, 18, 2, P.white)
  p.rect(3, 6, 14, 3, "#e07a2a")
  p.rect(19, 5, 9, 8, "#e07a2a")
  p.rect(21, 6, 5, 3, P.glass)
  p.rect(19, 11, 9, 2, "#a8561a")
  for (const x of [6, 23]) {
    disc(p, x, 13, 2, P.ink)
    p.px(x, 13, P.stoneLight)
  }
  return p.outline(P.ink)
}

export function paintCrate(): Pix {
  return new Pix(8, 8).pattern(0, 0, GOODS.crate!.rows, GOODS.crate!.key).outline(P.ink)
}

/** A coin, face-on; tweening scaleX gives the spin. */
export function paintCoin(): Pix {
  return new Pix(8, 8).pattern(
    0,
    0,
    ["..aaaa..", ".abbbba.", "abbccbba", "abcbbcba", "abcbbcba", "abbccbba", ".abbbba.", "..aaaa.."],
    {
      a: P.coinDark,
      b: P.coin,
      c: P.coinLight,
    },
  )
}

export function paintCloud(): Pix {
  const p = new Pix(40, 20)
  disc(p, 12, 12, 7, "#8a94a6")
  disc(p, 22, 9, 8, "#8a94a6")
  disc(p, 30, 13, 6, "#8a94a6")
  disc(p, 20, 8, 5, "#a7b0c0")
  p.rect(6, 14, 30, 4, "#6f7a8d")
  return p.outline(P.ink)
}

export function paintPuff(): Pix {
  const p = new Pix(8, 8)
  disc(p, 4, 4, 3, "#e6e2da")
  p.px(3, 3, P.white)
  return p
}

export function paintDrop(): Pix {
  return new Pix(2, 5).rect(1, 0, 1, 3, "#bfe6f2").rect(0, 3, 1, 2, "#7fb8d8")
}

export function paintSparkle(): Pix {
  return new Pix(5, 5).pattern(0, 0, ["..a..", "..b..", "abcba", "..b..", "..a.."], {
    a: P.foam,
    b: P.white,
    c: P.white,
  })
}

/** A soft round light for night windows and lamps, drawn with additive blending. */
export function paintGlow(size = 32): Pix {
  const p = new Pix(size, size)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c
      if (d < 1) p.px(x, y, P.lampGlow, Math.round(255 * (1 - d) ** 2))
    }
  return p
}

export function paintBulb(c: Hex): Pix {
  return new Pix(3, 3).pattern(0, 0, [".a.", "aba", ".a."], { a: c, b: P.white })
}
