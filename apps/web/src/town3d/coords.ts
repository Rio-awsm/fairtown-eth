import type { Point } from "../game/map/anchors"

/** One map tile (16 map px) is one world unit; map x runs along world x, map y along world z. */
export const TILE_PX = 16

export const toWorld = (p: Point) => ({ x: p.x / TILE_PX, z: p.y / TILE_PX })
export const toMap = (w: { x: number; z: number }): Point => ({ x: w.x * TILE_PX, y: w.z * TILE_PX })

/**
 * Normalised device coordinates (−1..1, y up) to the 1920 × 1080 canvas space the e2e tests and
 * __TOWN__.stallsOnScreen use, whatever size the canvas is drawn at.
 */
export function ndcToCanvas(ndc: { x: number; y: number }, view = { w: 1920, h: 1080 }): Point {
  return { x: ((ndc.x + 1) / 2) * view.w, y: ((1 - ndc.y) / 2) * view.h }
}
