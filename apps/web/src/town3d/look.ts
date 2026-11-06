/**
 * How the town looks, as pure rules: which palette texels are glass (they glow at night), the
 * graphite clay every building is turned into, and how a model is scaled into its space.
 */

/** Kenney's palette glass is a pale, blue-leaning colour; blue paint is darker, white is neutral. */
export function isGlass(r: number, g: number, b: number): boolean {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum > 165 && b - r > 25 && b >= g && b < 256
}

/** Graphite clay: a cool grey that keeps a texel's lightness, so shapes and trims still read. */
export function clayTone(r: number, g: number, b: number): [number, number, number] {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const v = 30 + lum * 92
  return [Math.round(v), Math.round(v + 4), Math.round(v + 14)]
}

/** Uniform scale that fits a model's size into a space (width and depth, or height). */
export function fitScale(
  size: { x: number; y: number; z: number },
  space: { w?: number; d?: number; h?: number },
): number {
  const ratios: number[] = []
  if (space.w !== undefined && size.x > 1e-6) ratios.push(space.w / size.x)
  if (space.d !== undefined && size.z > 1e-6) ratios.push(space.d / size.z)
  if (space.h !== undefined && size.y > 1e-6) ratios.push(space.h / size.y)
  return ratios.length === 0 ? 1 : Math.min(...ratios)
}
