import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import type { Fx } from "./fx"

export type LineOpts = { width?: number; dashed?: boolean; opacity?: number }

/**
 * A neon line through points, a few pixels wide at any zoom (D-122): bids, walks and truck routes.
 * Fewer than two points is not a line: null.
 */
export function neonLine(points: THREE.Vector3[], colour: number, o: LineOpts = {}): Line2 | null {
  if (points.length < 2) return null
  const geometry = new LineGeometry()
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))
  const material = new LineMaterial({
    color: colour,
    linewidth: o.width ?? 3,
    dashed: o.dashed ?? false,
    dashSize: 0.32,
    gapSize: 0.22,
    transparent: true,
    opacity: o.opacity ?? 0.9,
    depthWrite: false,
    toneMapped: false,
  })
  const line = new Line2(geometry, material)
  line.computeLineDistances()
  line.renderOrder = 3
  return line
}

export function disposeLine(line: Line2): void {
  line.removeFromParent()
  line.geometry.dispose()
  line.material.dispose()
}

/** Points along a hop from a to b, `height` above the straight line at the middle. */
export function hopPoints(a: THREE.Vector3, b: THREE.Vector3, height: number, steps = 16): THREE.Vector3[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const p = a.clone().lerp(b, t)
    p.y += Math.sin(Math.PI * t) * height
    return p
  })
}

/** A bid: a beam of the bidder's colour arcs to the stall, holds, and fades. */
export function laser(fx: Fx, from: THREE.Vector3, to: THREE.Vector3, colour: number, ms = 1600): void {
  // A short hop would hide in the crowd at the stall: every bid arcs well clear of it.
  const line = neonLine(hopPoints(from, to, 1.6 + from.distanceTo(to) * 0.15), colour, { width: 5 })
  if (!line) return
  fx.root.add(line)
  fx.clock.tween(
    ms / fx.speed,
    (t) => {
      line.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
    },
    () => disposeLine(line),
  )
}
