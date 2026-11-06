type Rect = { left: number; top: number; right: number; bottom: number }

/**
 * Which labels to hide so none overlap: the most important keep their place, and a label that
 * would touch one already kept (within `gap` px) is hidden. Ties go to the one listed first.
 * Returns the indices to hide.
 */
export function declutter(labels: { rect: Rect; priority: number }[], gap = 4): number[] {
  const order = labels.map((l, i) => ({ ...l, i })).sort((a, b) => b.priority - a.priority || a.i - b.i)
  const kept: Rect[] = []
  const hidden: number[] = []
  for (const l of order) {
    const { rect } = l
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue
    const clash = kept.some(
      (k) =>
        rect.left < k.right + gap &&
        rect.right + gap > k.left &&
        rect.top < k.bottom + gap &&
        rect.bottom + gap > k.top,
    )
    if (clash) hidden.push(l.i)
    else kept.push(rect)
  }
  return hidden.sort((a, b) => a - b)
}

/** Zoom levels a gesture settles on, from the whole town (1) to a street view (6). */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6] as const

/** The next step in a direction; stays put at either end. A zoom between steps snaps first. */
export function nextStep(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_STEPS[0]
}

/** The step nearest a zoom, for settling after a pinch or a trackpad scroll. */
export const nearestStep = (zoom: number) =>
  ZOOM_STEPS.reduce<number>((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best), ZOOM_STEPS[0])

/** Zoom after a trackpad or pinch delta: exponential, so each movement feels the same at any zoom. */
export function zoomBy(zoom: number, deltaY: number, perPixel: number): number {
  return Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1]!, Math.max(ZOOM_STEPS[0], zoom * Math.exp(-deltaY * perPixel)))
}
