export type Facing = "down" | "left" | "right" | "up"

/** Which of the 4 sprite directions a move faces. Ties go vertical; no move keeps the current facing. */
export function facing(dx: number, dy: number, current: Facing = "down"): Facing {
  if (dx === 0 && dy === 0) return current
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left"
  return dy > 0 ? "down" : "up"
}
