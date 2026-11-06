/**
 * Zoom that fits the map in the view. Pixel art needs a whole-number zoom, so a fit within 5 % of
 * one snaps to it (the 960 × 544 town fits at 1.985 and snaps to 2, cropping 8 px of map).
 */
export function fitZoom(view: { width: number; height: number }, map: { w: number; h: number }): number {
  if (map.w <= 0 || map.h <= 0) return 1
  const fit = Math.min(view.width / map.w, view.height / map.h)
  const whole = Math.round(fit)
  return whole >= 1 && Math.abs(fit - whole) / whole <= 0.05 ? whole : fit
}

/** "Flower Hall · Mumbai · Nairobi to Amsterdam" → title "Flower Hall", subtitle "Mumbai · Nairobi to Amsterdam". */
export function splitSign(text: string): { title: string; subtitle: string | null } {
  const at = text.indexOf(" · ")
  if (at < 0) return { title: text, subtitle: null }
  return { title: text.slice(0, at), subtitle: text.slice(at + 3) }
}

/** Sine ease-in-out for a camera glide: 0 → 0, 0.5 → 0.5, 1 → 1, clamped outside 0..1. */
export function glideAt(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return 0.5 - Math.cos(Math.PI * p) / 2
}
