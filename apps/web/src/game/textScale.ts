/** Demo mode (`?demo=1`, S3 5.1) makes town text bigger for a projector. Set once when the scene starts. */
let scale = 1
export const setTextScale = (s: number) => {
  scale = s
}
/** Jersey 10 is drawn small for its size; sizes in the scene are written in the old units. */
const FACE = 1.35
export const fs = (px: number) => `${Math.round(px * scale * FACE * 10) / 10}px`
