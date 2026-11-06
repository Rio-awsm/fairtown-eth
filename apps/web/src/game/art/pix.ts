/**
 * A tiny pixel canvas: RGBA bytes, no DOM. Every Fairtown sprite and tile is painted with it, so
 * the art is our own, deterministic, and testable in Node. `toCanvas` hands it to a canvas.
 */
export type Hex = `#${string}`

const cache = new Map<string, [number, number, number]>()
export function rgb(hex: Hex): [number, number, number] {
  let v = cache.get(hex)
  if (!v) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`)
    v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
    cache.set(hex, v)
  }
  return v
}

/** Seeded PRNG (mulberry32): the same seed always paints the same pixels. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable small number for a string, for picking looks by id. */
export function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export class Pix {
  readonly data: Uint8ClampedArray

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) throw new Error(`bad size ${w}x${h}`)
    this.data = new Uint8ClampedArray(w * h * 4)
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  /** Paints one pixel; out-of-bounds pixels are clipped, alpha defaults to opaque. */
  px(x: number, y: number, c: Hex, alpha = 255): this {
    x = Math.floor(x)
    y = Math.floor(y)
    if (!this.inside(x, y)) return this
    const [r, g, b] = rgb(c)
    this.data.set([r, g, b, alpha], (y * this.w + x) * 4)
    return this
  }

  rect(x: number, y: number, w: number, h: number, c: Hex, alpha = 255): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, alpha)
    return this
  }

  /** Paints a picture written as rows of characters; `.` and space are transparent. */
  pattern(x: number, y: number, rows: readonly string[], key: Record<string, Hex>): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!
        if (ch === "." || ch === " ") continue
        const c = key[ch]
        if (!c) throw new Error(`pattern uses "${ch}" with no colour`)
        this.px(x + i, y + j, c)
      }
    })
    return this
  }

  alphaAt(x: number, y: number): number {
    return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3]! : 0
  }

  hexAt(x: number, y: number): Hex | null {
    if (this.alphaAt(x, y) === 0) return null
    const i = (y * this.w + x) * 4
    const h = (n: number) => this.data[i + n]!.toString(16).padStart(2, "0")
    return `#${h(0)}${h(1)}${h(2)}`
  }

  /** A 1 px outline in `c` on every transparent pixel next to an opaque one (4-neighbour). */
  outline(c: Hex): this {
    const edge: [number, number][] = []
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y) !== 0) continue
        if (this.alphaAt(x - 1, y) || this.alphaAt(x + 1, y) || this.alphaAt(x, y - 1) || this.alphaAt(x, y + 1))
          edge.push([x, y])
      }
    for (const [x, y] of edge) this.px(x, y, c)
    return this
  }

  /** Copies the opaque pixels of `src` onto this canvas at (dx, dy). */
  blit(src: Pix, dx: number, dy: number, flipX = false): this {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x
        const i = (y * src.w + sx) * 4
        const a = src.data[i + 3]!
        if (a === 0) continue
        const tx = dx + x
        const ty = dy + y
        if (!this.inside(tx, ty)) continue
        this.data.set(src.data.subarray(i, i + 4), (ty * this.w + tx) * 4)
      }
    return this
  }

  /** Every distinct opaque colour, for palette checks in tests. */
  colours(): Set<Hex> {
    const out = new Set<Hex>()
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.hexAt(x, y)
        if (c) out.add(c)
      }
    return out
  }
}

/** Browser only: a canvas element holding the pixels, ready for `textures.addCanvas`. */
export function toCanvas(p: Pix): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = p.w
  canvas.height = p.h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2d canvas is not available")
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.w, p.h), 0, 0)
  return canvas
}
