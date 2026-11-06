import type { Hex, Pix } from "./pix"

export type Run = { x: number; y: number; w: number; c: Hex; a: number }

/** A region of a Pix as horizontal same-colour runs: few enough rects to draw as crisp SVG. */
export function runsOf(p: Pix, sx = 0, sy = 0, w = p.w, h = p.h): Run[] {
  const out: Run[] = []
  for (let y = 0; y < h; y++) {
    let run: Run | null = null
    for (let x = 0; x < w; x++) {
      const c = p.hexAt(sx + x, sy + y)
      const a = p.alphaAt(sx + x, sy + y)
      if (run && c === run.c && a === run.a) {
        run.w++
        continue
      }
      if (run) out.push(run)
      run = c ? { x, y, w: 1, c, a } : null
    }
    if (run) out.push(run)
  }
  return out
}
